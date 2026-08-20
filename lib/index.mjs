import Schema from "@deepseek-ai/schemastery";
import * as webFetchHttp from "@deepseek-ai/dsh-web-fetch-http";
import { Service } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";

//#region src/markdown.ts
function scalar(value) {
	const trimmed = value.trim();
	if (trimmed === "") return "";
	if (trimmed.startsWith("\"") && trimmed.endsWith("\"") || trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (trimmed === "null") return null;
	if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
	if (trimmed.startsWith("[") && trimmed.endsWith("]") || trimmed.startsWith("{") && trimmed.endsWith("}")) try {
		return JSON.parse(trimmed);
	} catch {
		return trimmed;
	}
	return trimmed;
}
function parseFrontmatter(text) {
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return {
		frontmatter: {},
		body: text
	};
	const frontmatter = {};
	for (const line of (match[1] ?? "").split(/\r?\n/)) {
		const separator = line.indexOf(":");
		if (separator <= 0) continue;
		const key = line.slice(0, separator).trim();
		frontmatter[key] = scalar(line.slice(separator + 1));
	}
	return {
		frontmatter,
		body: match[2] ?? ""
	};
}
function parseTable(lines, start) {
	const headerLine = lines[start];
	const separatorLine = lines[start + 1];
	if (!headerLine || !separatorLine || !/^\s*\|?\s*:?-{2,}/.test(separatorLine)) return void 0;
	const split = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
	const headers = split(headerLine);
	if (headers.length === 0 || headers.some((header) => header === "")) return void 0;
	const rows = [];
	let index = start + 2;
	while (index < lines.length && lines[index]?.includes("|")) {
		const cells = split(lines[index] ?? "");
		if (cells.length > 0) rows.push(Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""])));
		index += 1;
	}
	return {
		table: {
			headers,
			rows
		},
		next: index
	};
}
function titleFrom(path, body, frontmatter) {
	if (typeof frontmatter.title === "string" && frontmatter.title.trim()) return frontmatter.title.trim();
	const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
	if (heading) return heading;
	return (path.replace(/\\/g, "/").split("/").at(-1) ?? path).replace(/\.[^.]+$/, "");
}
function parseNote(path, text) {
	const { frontmatter, body } = parseFrontmatter(text);
	const lines = body.split(/\r?\n/);
	const headings = lines.flatMap((line) => {
		const match = line.match(/^#{1,6}\s+(.+)$/);
		return match?.[1]?.trim() ? [match[1].trim()] : [];
	});
	const tables = [];
	for (let index = 0; index < lines.length - 1; index += 1) {
		const parsed = parseTable(lines, index);
		if (!parsed) continue;
		tables.push(parsed.table);
		index = parsed.next - 1;
	}
	const externalLinks = [...new Set([
		...(body.match(/https?:\/\/[^\s)\]>]+/g) ?? []).map((url) => url.replace(/[.,]+$/, "")),
		...typeof frontmatter.source === "string" && /^https?:\/\//.test(frontmatter.source) ? [frontmatter.source] : [],
		...typeof frontmatter.url === "string" && /^https?:\/\//.test(frontmatter.url) ? [frontmatter.url] : []
	])];
	const words = body.trim() ? body.trim().split(/\s+/).length : 0;
	return {
		path,
		title: titleFrom(path, body, frontmatter),
		content: body,
		frontmatter,
		headings,
		tables,
		externalLinks,
		wordCount: words
	};
}
function recordsFromNote(note) {
	const records = note.tables.flatMap((table) => table.rows);
	if (records.length > 0) return records;
	const frontmatter = note.frontmatter;
	if (![
		"problem",
		"pain",
		"痛点",
		"opportunity",
		"机会"
	].some((field) => field in frontmatter)) return [];
	return [{
		...frontmatter,
		title: frontmatter.title ?? note.title,
		problem: frontmatter.problem ?? frontmatter.pain ?? frontmatter["痛点"] ?? note.title,
		source: frontmatter.source ?? note.path,
		capturedAt: frontmatter.capturedAt ?? frontmatter.date ?? frontmatter.updated
	}];
}

//#endregion
//#region src/data.ts
function castValue(value) {
	const trimmed = value.trim();
	if (trimmed === "") return "";
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (trimmed === "null") return null;
	if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
	return trimmed;
}
function parseCsv(text, delimiter = ",") {
	const rows = [];
	let row = [];
	let cell = "";
	let quoted = false;
	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];
		const next = text[index + 1];
		if (character === "\"") {
			if (quoted && next === "\"") {
				cell += "\"";
				index += 1;
			} else quoted = !quoted;
			continue;
		}
		if (!quoted && character === delimiter) {
			row.push(cell);
			cell = "";
			continue;
		}
		if (!quoted && (character === "\n" || character === "\r")) {
			if (character === "\r" && next === "\n") index += 1;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
			continue;
		}
		cell += character ?? "";
	}
	if (cell !== "" || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	const headers = (rows.shift() ?? []).map((header, index) => header.trim() || `column_${index + 1}`);
	return rows.filter((values) => values.some((value) => value.trim() !== "")).map((values) => Object.fromEntries(headers.map((header, index) => [header, castValue(values[index] ?? "")])));
}
function objectRecords(value) {
	if (Array.isArray(value)) return value.filter((item) => typeof item === "object" && item !== null && !Array.isArray(item));
	if (typeof value === "object" && value !== null) return [value];
	return [];
}
function parseRecords(path, text) {
	const extension$1 = path.toLowerCase().split(".").at(-1);
	if (extension$1 === "csv" || extension$1 === "tsv") return {
		records: parseCsv(text, extension$1 === "tsv" ? "	" : ","),
		warnings: []
	};
	if (extension$1 === "jsonl" || extension$1 === "ndjson") {
		const warnings = [];
		const records = [];
		for (const [index, line] of text.split(/\r?\n/).entries()) {
			if (!line.trim()) continue;
			try {
				records.push(...objectRecords(JSON.parse(line)));
			} catch {
				warnings.push(`Line ${index + 1} is not valid JSON and was skipped.`);
			}
		}
		return {
			records,
			warnings
		};
	}
	if (extension$1 === "json") try {
		return {
			records: objectRecords(JSON.parse(text)),
			warnings: []
		};
	} catch {
		return {
			records: [],
			warnings: ["The JSON file could not be parsed."]
		};
	}
	if (extension$1 === "md" || extension$1 === "mdown" || extension$1 === "markdown") {
		const note = parseNote(path, text);
		return {
			records: recordsFromNote(note),
			warnings: note.tables.length === 0 ? ["No Markdown table or signal frontmatter was found."] : []
		};
	}
	return {
		records: [],
		warnings: [`Unsupported file extension: .${extension$1 ?? "unknown"}`]
	};
}
async function readRecords(fs, config, path, signal) {
	const target = await fs.resolve(path, { signal });
	const info = await fs.stat(target, signal);
	if (!info || info.type !== "file") throw new Error(`Signal source is not a file: ${path}`);
	if ((info.size ?? 0) > config.maxFileBytes) throw new Error(`Signal source exceeds maxFileBytes (${config.maxFileBytes}): ${path}`);
	const text = await fs.readText(target, signal);
	if (text.length > config.maxTextChars) throw new Error(`Signal source exceeds maxTextChars (${config.maxTextChars}): ${path}`);
	return {
		source: path,
		...parseRecords(path, text)
	};
}

//#endregion
//#region src/signals.ts
const aliases = {
	title: [
		"title",
		"name",
		"subject",
		"痛点标题",
		"标题"
	],
	problem: [
		"problem",
		"pain",
		"pain_point",
		"painPoint",
		"痛点",
		"问题",
		"content",
		"text",
		"description"
	],
	user: [
		"user",
		"target_user",
		"targetUser",
		"persona",
		"目标用户",
		"用户",
		"audience"
	],
	scene: [
		"scene",
		"context",
		"scenario",
		"pain_scene",
		"痛点场景",
		"场景",
		"情境"
	],
	source: [
		"source",
		"source_name",
		"sourceName",
		"来源",
		"channel",
		"社区来源"
	],
	sourceType: [
		"sourceType",
		"source_type",
		"来源类型"
	],
	sourceUrl: [
		"sourceUrl",
		"source_url",
		"url",
		"link",
		"链接",
		"来源链接"
	],
	capturedAt: [
		"capturedAt",
		"captured_at",
		"date",
		"createdAt",
		"created_at",
		"updated",
		"日期",
		"时间"
	],
	quote: [
		"quote",
		"original",
		"raw",
		"原话",
		"原始证据",
		"原文"
	],
	behavior: [
		"behavior",
		"behaviour",
		"user_behavior",
		"行为",
		"用户行为"
	],
	workaround: [
		"workaround",
		"alternative",
		"current_solution",
		"当前替代",
		"当前方案",
		"替代方案"
	],
	cost: [
		"cost",
		"loss",
		"impact",
		"代价",
		"损失",
		"成本"
	],
	paymentSignal: [
		"paymentSignal",
		"payment_signal",
		"payment",
		"commitment",
		"付费信号",
		"承诺"
	],
	whyNow: [
		"whyNow",
		"why_now",
		"trigger",
		"触发因素",
		"为什么是现在"
	],
	painScore: [
		"painScore",
		"pain_score",
		"score",
		"severity",
		"痛苦程度",
		"痛苦分数",
		"评分"
	],
	repeatCount: [
		"repeatCount",
		"repeat_count",
		"mentions",
		"frequency",
		"重复提及数",
		"提及数",
		"频率"
	],
	tags: [
		"tags",
		"tag",
		"labels",
		"标签"
	],
	evidenceState: [
		"evidenceState",
		"evidence_state",
		"状态",
		"证据状态"
	]
};
function stringValue(value) {
	if (value === void 0 || value === null) return void 0;
	if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
	if (typeof value === "object") return JSON.stringify(value);
	return String(value).trim() || void 0;
}
function firstValue(record, key) {
	for (const alias of aliases[key] ?? [key]) {
		const value = stringValue(record[alias]);
		if (value) return value;
	}
}
function numberValue(record, key) {
	const raw = firstValue(record, key);
	if (!raw) return void 0;
	const number = Number(raw.replace(/[^\d.-]/g, ""));
	return Number.isFinite(number) ? number : void 0;
}
function parseTags(record) {
	const raw = firstValue(record, "tags");
	return raw ? [...new Set(raw.split(/[,，;；|/\s]+/).map((tag) => tag.trim()).filter(Boolean))] : [];
}
function inferSourceType$1(value) {
	const source = (value ?? "").toLowerCase();
	if (/interview|访谈|观察/.test(source)) return "interview";
	if (/support|客服|工单/.test(source)) return "support";
	if (/reddit|hacker|community|社区|论坛|问答/.test(source)) return "community";
	if (/review|app.?store|评论|评价/.test(source)) return "review";
	if (/github|issue|bug/.test(source)) return "issue";
	if (/search|trend|搜索|趋势/.test(source)) return "search";
	if (/competitor|竞品|替代/.test(source)) return "competitor";
	if (/survey|问卷/.test(source)) return "survey";
	return "other";
}
function clamp(value, minimum, maximum) {
	if (value === void 0 || !Number.isFinite(value)) return void 0;
	return Math.max(minimum, Math.min(maximum, value));
}
function strengthFor(signal) {
	const count = [
		signal.sourceUrl,
		signal.quote,
		signal.behavior,
		signal.workaround,
		signal.cost
	].filter(Boolean).length;
	if (count >= 4 || signal.sourceUrl && signal.behavior && (signal.repeatCount ?? 0) >= 3) return "strong";
	if (count >= 2 || signal.sourceUrl || signal.behavior) return "medium";
	return "weak";
}
function stableId(text, index) {
	let hash = 2166136261;
	for (const character of text) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}
	return `signal-${(hash >>> 0).toString(16)}-${index + 1}`;
}
function normalizeSignal(record, index, source) {
	const problem = firstValue(record, "problem") ?? firstValue(record, "title");
	if (!problem) return void 0;
	const sourceName = firstValue(record, "source") ?? source;
	const base = {
		title: firstValue(record, "title") ?? problem.slice(0, 80),
		problem,
		user: firstValue(record, "user") ?? "",
		scene: firstValue(record, "scene") ?? "",
		source: sourceName,
		sourceType: inferSourceType$1(firstValue(record, "sourceType") ?? sourceName),
		sourceUrl: firstValue(record, "sourceUrl"),
		capturedAt: firstValue(record, "capturedAt"),
		quote: firstValue(record, "quote"),
		behavior: firstValue(record, "behavior"),
		workaround: firstValue(record, "workaround"),
		cost: firstValue(record, "cost"),
		paymentSignal: firstValue(record, "paymentSignal") ?? firstValue(record, "payment") ?? firstValue(record, "commitment"),
		whyNow: firstValue(record, "whyNow") ?? firstValue(record, "why_now") ?? firstValue(record, "trigger"),
		painScore: clamp(numberValue(record, "painScore"), 1, 10),
		repeatCount: clamp(numberValue(record, "repeatCount"), 1, 1e5),
		tags: parseTags(record),
		notes: firstValue(record, "notes")
	};
	const evidenceStrength = strengthFor(base);
	const rawState = firstValue(record, "evidenceState")?.toLowerCase();
	const evidenceState = rawState === "validated" || rawState === "已验证" ? "validated" : rawState === "inference" || rawState === "推断" ? "inference" : "signal";
	return {
		id: stableId(`${source}|${problem}`, index),
		...base,
		evidenceStrength,
		evidenceState
	};
}
function normalizeSignals(records, source) {
	const signals = [];
	let skipped = 0;
	for (const [index, record] of records.entries()) {
		const signal = normalizeSignal(record, index, source);
		if (!signal) skipped += 1;
		else signals.push(signal);
	}
	return {
		signals,
		skipped
	};
}
function includes(text, query) {
	return Boolean(text?.toLocaleLowerCase().includes(query));
}
function verifiability(signal) {
	return [
		signal.sourceUrl,
		signal.quote,
		signal.behavior,
		signal.workaround,
		signal.cost
	].filter(Boolean).length * 2 + ((signal.repeatCount ?? 0) > 0 ? 2 : 0) + (signal.evidenceStrength === "strong" ? 3 : signal.evidenceStrength === "medium" ? 1 : 0);
}
function signalQuality(signal) {
	const missing = [];
	const reasons = [];
	if (!signal.sourceUrl) missing.push("sourceUrl");
	if (!signal.behavior) missing.push("behavior");
	if (!signal.workaround) missing.push("workaround");
	if (!signal.cost) missing.push("cost");
	if (!signal.whyNow) missing.push("whyNow");
	if ((signal.repeatCount ?? 0) < 2) missing.push("repeatCount");
	if (signal.sourceUrl) reasons.push("可追溯来源");
	if (signal.behavior) reasons.push("有具体行为");
	if (signal.workaround) reasons.push("记录了当前替代方案");
	if (signal.paymentSignal) reasons.push("出现支付、迁移或承诺信号");
	if (signal.whyNow) reasons.push("记录了触发变化或为什么是现在");
	if ((signal.repeatCount ?? 0) >= 2) reasons.push("有重复出现");
	return {
		score: Math.min(100, Math.round(verifiability(signal) * 5)),
		missing,
		reasons
	};
}
function filterSignals(signals, filter = {}) {
	const query = filter.query?.trim().toLocaleLowerCase();
	const sorted = [...signals.filter((signal) => {
		if (query) {
			if (![
				signal.title,
				signal.problem,
				signal.user,
				signal.scene,
				signal.source,
				signal.quote,
				signal.workaround,
				...signal.tags
			].join(" ").toLocaleLowerCase().includes(query)) return false;
		}
		if (filter.user && !includes(signal.user, filter.user.toLocaleLowerCase())) return false;
		if (filter.scene && !includes(signal.scene, filter.scene.toLocaleLowerCase())) return false;
		if (filter.sourceType && signal.sourceType !== filter.sourceType) return false;
		if (filter.minPain !== void 0 && (signal.painScore ?? 0) < filter.minPain) return false;
		if (filter.minRepeat !== void 0 && (signal.repeatCount ?? 0) < filter.minRepeat) return false;
		if (filter.since && (!signal.capturedAt || signal.capturedAt < filter.since)) return false;
		return true;
	})].sort((left, right) => {
		if (filter.sort === "repeat") return (right.repeatCount ?? 0) - (left.repeatCount ?? 0);
		if (filter.sort === "pain") return (right.painScore ?? 0) - (left.painScore ?? 0);
		if (filter.sort === "verifiable") return verifiability(right) - verifiability(left);
		return (right.capturedAt ?? "").localeCompare(left.capturedAt ?? "");
	});
	return filter.limit && filter.limit > 0 ? sorted.slice(0, Math.min(filter.limit, 500)) : sorted.slice(0, 500);
}
function themeKey(signal) {
	return `${signal.scene.trim().toLocaleLowerCase() || "未分类场景"}|${signal.user.trim().toLocaleLowerCase() || "目标用户待确认"}`;
}
function themeId(key) {
	return `opportunity-${key.replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-").replace(/^-|-$/g, "").slice(0, 64) || "unknown"}`;
}
function buildOpportunityMap(signals, source) {
	const groups = /* @__PURE__ */ new Map();
	for (const signal of signals) groups.set(themeKey(signal), [...groups.get(themeKey(signal)) ?? [], signal]);
	const themes = [];
	for (const [key, group] of groups) {
		const parts = key.split("|");
		const scene = parts[0] ?? "未分类场景";
		const user = parts[1] ?? "目标用户待确认";
		const averagePain = group.filter((signal) => signal.painScore !== void 0).map((signal) => signal.painScore ?? 0);
		const repeat = group.reduce((sum, signal) => sum + (signal.repeatCount ?? 1), 0);
		const quality = group.map(signalQuality);
		const evidenceScore = Math.round(quality.reduce((sum, item) => sum + item.score, 0) / Math.max(1, quality.length));
		const representativeProblems = [...new Set(group.map((signal) => signal.problem))].slice(0, 5);
		const workarounds = [...new Set(group.map((signal) => signal.workaround).filter((value) => Boolean(value)))].slice(0, 5);
		themes.push({
			id: themeId(key),
			title: `${scene} × ${user}`,
			user,
			scene,
			opportunity: `帮助${user}在${scene}中更可靠、更省力地完成当前任务，减少反复、等待或出错。`,
			signalCount: group.length,
			totalRepeatCount: repeat,
			averagePainScore: averagePain.length > 0 ? Math.round(averagePain.reduce((sum, value) => sum + value, 0) / averagePain.length * 10) / 10 : null,
			evidenceScore,
			signalIds: group.map((signal) => signal.id),
			representativeProblems,
			currentWorkarounds: workarounds,
			risks: evidenceScore < 40 ? ["证据较弱：补充行为、来源或重复出现次数。"] : ["还未验证触达、付费意愿和方案可行性。"]
		});
	}
	themes.sort((left, right) => right.evidenceScore + right.totalRepeatCount - (left.evidenceScore + left.totalRepeatCount));
	return {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		source,
		signalsConsidered: signals.length,
		themes,
		warnings: signals.length === 0 ? ["No usable signals were found; opportunity themes are unavailable."] : [],
		nextActions: themes.length > 0 ? ["为前两个机会主题补充同类用户访谈。", "为证据最强的主题设计一个不写完整产品的最小实验。"] : ["导入包含 problem/pain/痛点 字段的 Markdown、CSV、JSON 或 JSONL 文件。"]
	};
}
const lenses = [
	{
		lens: "automation",
		label: "自动化关键重复步骤"
	},
	{
		lens: "copilot",
		label: "提供情境化辅助和决策支持"
	},
	{
		lens: "workflow",
		label: "重组跨工具工作流"
	},
	{
		lens: "marketplace",
		label: "连接供需双方或可复用资源"
	},
	{
		lens: "education",
		label: "提供结构化方法、模板与陪跑服务"
	}
];
function generateCandidates(themes, maxPerTheme = 2) {
	const candidates = [];
	for (const theme of themes) for (const [index, item] of lenses.slice(0, Math.max(1, Math.min(maxPerTheme, lenses.length))).entries()) {
		const title = `${theme.scene}场景的${item.label}`;
		const problem = theme.representativeProblems[0] ?? theme.opportunity;
		const confidence = theme.evidenceScore >= 70 ? "high" : theme.evidenceScore >= 40 ? "medium" : "low";
		candidates.push({
			id: `idea-${theme.id.replace(/^opportunity-/, "")}-${item.lens}`,
			themeId: theme.id,
			title,
			user: theme.user,
			scene: theme.scene,
			problem,
			solutionLens: item.lens,
			solution: `围绕“${problem}”，${item.label}，先覆盖一个窄场景并保留人工兜底。`,
			whyNow: theme.totalRepeatCount > theme.signalCount ? "同类信号有重复出现，值得先验证问题强度。" : "当前信号可以作为探索入口，但还需要补充重复性和时间窗口证据。",
			evidence: [
				`${theme.signalCount} 条信号`,
				`总重复提及约 ${theme.totalRepeatCount} 次`,
				`证据评分 ${theme.evidenceScore}/100`
			],
			riskiestAssumption: `目标用户愿意改变当前 workaround，并为${item.label}投入时间、预算或承诺。`,
			score: {
				problem: theme.averagePainScore ? Math.round(theme.averagePainScore * 10) / 2 : 2,
				evidence: Math.max(1, Math.round(theme.evidenceScore / 20)),
				reachability: null,
				feasibility: null,
				testability: Math.max(1, 6 - index)
			},
			confidence,
			nextTest: confidence === "low" ? "先做 5 次问题访谈，确认最近一次行为和当前代价。" : "用 concierge 或低保真原型测试一个真实任务。"
		});
	}
	return candidates;
}
function buildExperiment(candidate) {
	const method = candidate.confidence === "low" ? "interview" : candidate.solutionLens === "automation" ? "concierge" : "prototype";
	return {
		candidateId: candidate.id,
		hypothesis: `如果${candidate.user}在${candidate.scene}中使用“${candidate.title}”，那么他们会减少当前任务中的关键损失，并愿意继续使用或付出明确承诺。`,
		riskiestAssumption: candidate.riskiestAssumption,
		method,
		audience: candidate.user,
		steps: method === "interview" ? [
			"招募 5 位最近遇到该场景的人。",
			"要求他们复盘最近一次真实经历，不展示方案。",
			"记录触发、步骤、替代方案和代价。",
			"询问他们如何判断问题已解决。"
		] : [
			"选一个窄场景和一个可观察任务。",
			"用人工服务或低保真原型完成任务。",
			"观察用户是否主动完成关键步骤。",
			"访谈用户对结果、替代方案和继续使用意愿的看法。"
		],
		evidenceToCollect: [
			"最近一次真实行为",
			"当前 workaround 和投入成本",
			"是否愿意安排时间继续测试",
			"是否出现明确的付费、预订或转介绍承诺"
		],
		successThreshold: method === "interview" ? "至少 3/5 人独立描述同类问题，并有明确当前代价。" : "至少 3/5 个目标用户完成关键任务，并主动要求继续使用或接受下一步。",
		failureThreshold: "多数用户没有近期行为、问题代价很低，或现有替代方案已经足够好。",
		duration: method === "interview" ? "2–3 天" : "3–7 天",
		decisionRule: "达到成功阈值则扩大样本或测试付费；未达到则调整人群/场景/问题定义，不直接扩大开发范围。",
		guardrails: [
			"不把礼貌性正反馈当作需求证据。",
			"不收集超出验证所需的个人敏感信息。",
			"记录来源、日期和原始行为摘要。"
		]
	};
}

//#endregion
//#region src/service.ts
var IdeaDiscoveryService = class extends Service {
	fs;
	config;
	constructor(ctx, fs, config) {
		super(ctx, "idea-discovery");
		this.fs = fs;
		this.config = config;
	}
	async importSignals(path, signal) {
		const imported = await readRecords(this.fs, this.config, path, signal);
		const normalized = normalizeSignals(imported.records, path);
		return {
			source: path,
			signals: normalized.signals,
			warnings: [...imported.warnings, ...normalized.skipped > 0 ? [`Skipped ${normalized.skipped} rows without a problem/pain field.`] : []],
			rowsRead: imported.records.length,
			rowsAccepted: normalized.signals.length
		};
	}
	async filterSignals(path, filter = {}, signal) {
		const imported = await this.importSignals(path, signal);
		return {
			source: path,
			signals: filterSignals(imported.signals, filter),
			warnings: imported.warnings
		};
	}
	async buildMap(path, filter = {}, signal) {
		return buildOpportunityMap((await this.filterSignals(path, filter, signal)).signals, path);
	}
	async generateCandidates(path, filter = {}, maxPerTheme = 2, signal) {
		const map = await this.buildMap(path, filter, signal);
		return {
			source: path,
			themes: map.themes,
			candidates: generateCandidates(map.themes, maxPerTheme),
			warnings: [...map.warnings]
		};
	}
};

//#endregion
//#region src/discovery.ts
const sourceOrder = [
	"product-hunt",
	"trustmrr",
	"reddit",
	"g2",
	"github",
	"google-trends",
	"app-reviews",
	"job-boards",
	"policy"
];
const sourceCatalog = {
	"product-hunt": {
		id: "product-hunt",
		name: "Product Hunt",
		purpose: "观察新解法、早期采用者、产品定位、评论中的缺口和 maker 回复。",
		suggestedUrl: "https://www.producthunt.com/",
		inspect: [
			"同一类别近期发布",
			"评论中的 missing / alternative / too hard",
			"用户追问和 maker 回复",
			"产品定位、价格和分发方式"
		],
		evidenceType: "解决方案地图、早期市场语言和定位线索",
		bias: "发布热度和社区关注不等于留存、支付意愿或完整市场需求。"
	},
	trustmrr: {
		id: "trustmrr",
		name: "TrustMRR",
		purpose: "观察已商业化的 SaaS、应用和数字业务，以及价格、收入、技术栈和分发线索。",
		suggestedUrl: "https://trustmrr.com/",
		inspect: [
			"类别和细分人群",
			"收入/增长和价格区间",
			"技术栈与营销渠道",
			"最近上架项目及其价值主张"
		],
		evidenceType: "市场存在、价格锚点、商业化和分发线索",
		bias: "上架项目有选择偏差；收入口径需要核对，不能把项目直接当作可复制机会。"
	},
	reddit: {
		id: "reddit",
		name: "Reddit",
		purpose: "发现用户原话、具体场景、抱怨、替代方案和 workaround。",
		suggestedUrl: "https://www.reddit.com/",
		inspect: [
			"垂直 subreddit 的上下文",
			"how do I / alternative / frustrated / manually",
			"评论里的补充场景和替代产品",
			"用户是否描述了时间、金钱或风险代价"
		],
		evidenceType: "原生问题语言、用户场景和替代方案",
		bias: "单个社区不代表整个市场；需遵守版规，不把研究变成骚扰或营销。"
	},
	g2: {
		id: "g2",
		name: "G2",
		purpose: "从 B2B 软件评论中发现低评分原因、实施障碍、集成缺口和迁移需求。",
		suggestedUrl: "https://www.g2.com/",
		inspect: [
			"1–3 星评论",
			"Pros / Cons",
			"替代产品和迁移经历",
			"实施、集成、价格和支持问题"
		],
		evidenceType: "购买后反馈、产品缺口和迁移原因",
		bias: "评论有平台和样本偏差；评分不能单独证明机会或支付意愿。"
	},
	github: {
		id: "github",
		name: "GitHub Issues / Discussions",
		purpose: "发现开发者工具、API 和开源生态中的可复现缺口。",
		suggestedUrl: "https://github.com/",
		inspect: [
			"重复 Issue 和 Feature Request",
			"复现步骤和 workaround",
			"upvotes、标签和讨论上下文",
			"维护者是否回应以及生态限制"
		],
		evidenceType: "技术痛点、生态需求和可复现缺口",
		bias: "开源用户不等于付费用户；需求可能受项目路线和维护能力限制。"
	},
	"google-trends": {
		id: "google-trends",
		name: "Google Trends",
		purpose: "观察关键词相对兴趣、地区差异、季节性和“为什么是现在”的线索。",
		suggestedUrl: "https://trends.google.com/trends/",
		inspect: [
			"3–5 个同义词和替代词的比较",
			"时间趋势和季节性",
			"地区差异",
			"相关查询和新出现的表达"
		],
		evidenceType: "关注变化、市场教育和用户搜索语言",
		bias: "相对搜索兴趣不是销量、市场规模或支付意愿。"
	},
	"app-reviews": {
		id: "app-reviews",
		name: "App Store / Google Play Reviews",
		purpose: "发现移动场景中的版本回归、使用障碍和替代需求。",
		suggestedUrl: "https://play.google.com/store",
		inspect: [
			"1–3 星评论",
			"版本更新前后的问题变化",
			"重复抱怨和功能缺口",
			"用户是否提到替代应用"
		],
		evidenceType: "移动端真实使用反馈和版本相关问题",
		bias: "评论者是主动反馈人群；低评分可能来自一次性故障或期望落差。"
	},
	"job-boards": {
		id: "job-boards",
		name: "招聘信息与服务市场",
		purpose: "从反复出现的岗位职责、技能和外包需求中发现昂贵的内部工作流。",
		suggestedUrl: "https://www.indeed.com/",
		inspect: [
			"反复出现的手工流程",
			"合规、报表、对账和数据整理职责",
			"企业愿意持续付费的人力成本",
			"可被工具替代或增强的步骤"
		],
		evidenceType: "组织预算、工作流和触达入口线索",
		bias: "岗位描述是企业表达，不等于员工实际痛点；需要访谈或观察复核。"
	},
	policy: {
		id: "policy",
		name: "政策、标准与行业变化",
		purpose: "发现因法规、标准、补贴、技术成本或供应链变化产生的新任务。",
		suggestedUrl: "https://www.regulations.gov/",
		inspect: [
			"新义务和截止日期",
			"受影响的角色和组织",
			"合规成本与现有解决方式",
			"区域、语言和行业边界"
		],
		evidenceType: "外部变化、强制性任务和为什么是现在",
		bias: "政策变化不必然形成可支付产品；需要验证受影响者的工作量和预算。"
	}
};
function fill(template, context) {
	return template.replaceAll("{topic}", context.topic).replaceAll("{user}", context.targetUser || "目标用户").replaceAll("{market}", context.market || "目标市场").replaceAll("{region}", context.region || "目标地区");
}
function queriesFor(id, context) {
	return ({
		"product-hunt": [
			"{topic} Product Hunt launch",
			"site:producthunt.com {topic} alternative missing",
			"{topic} Product Hunt comments too hard expensive integration"
		],
		trustmrr: [
			"site:trustmrr.com {topic} startup SaaS",
			"TrustMRR {topic} category revenue pricing",
			"{topic} SaaS recently listed pricing tech stack"
		],
		reddit: [
			"site:reddit.com {topic} \"how do I\"",
			"site:reddit.com {topic} alternative frustrated manually",
			"site:reddit.com/r/{market} {topic} too expensive workaround"
		],
		g2: [
			"site:g2.com {topic} reviews cons alternative integration",
			"site:g2.com {topic} \"what do you dislike\"",
			"{topic} G2 low rating implementation pricing"
		],
		github: [
			"site:github.com/issues {topic} feature request workaround",
			"site:github.com {topic} issue alternative API missing",
			"{topic} GitHub Discussions integration pain"
		],
		"google-trends": [
			"Google Trends compare {topic} alternatives {region}",
			"{topic} related searches {market}",
			"{topic} seasonality demand {region}"
		],
		"app-reviews": [
			"{topic} app reviews missing feature alternative",
			"{topic} Google Play 1 star review problem",
			"{topic} App Store reviews sync crash expensive"
		],
		"job-boards": [
			"{market} {topic} job description manual workflow",
			"{topic} operations coordinator spreadsheet reporting job",
			"{topic} freelance service outsourcing pain"
		],
		policy: [
			"{market} {topic} regulation compliance deadline",
			"{topic} standard reporting requirement {region}",
			"{topic} policy change operational impact"
		]
	}[id] ?? []).map((template) => fill(template, context));
}
function buildSourcePlan(input) {
	const context = {
		topic: input.topic.trim(),
		targetUser: input.targetUser?.trim() || "",
		market: input.market?.trim() || "",
		region: input.region?.trim() || ""
	};
	return {
		externalFirst: true,
		context,
		sources: (input.sourceIds?.length ? [...new Set(input.sourceIds)] : sourceOrder.slice(0, 6)).map((id) => ({
			...sourceCatalog[id],
			queryTemplates: queriesFor(id, context)
		})),
		researchSequence: [
			"先用 Product Hunt / TrustMRR 建立解法和商业化地图。",
			"再用 Reddit / G2 / GitHub / 应用评论寻找用户原话、具体行为和 workaround。",
			"最后用 Google Trends、招聘、政策和竞品变化判断为什么是现在。",
			"至少用两个不同来源类型交叉验证一个机会，再进入 Idea 和实验阶段。"
		],
		evidenceGate: [
			"具体行为优先于未来愿望。",
			"重复出现、时间/金钱/风险代价和当前 workaround 会提高证据强度。",
			"来源热度不等于需求成立，商业化线索也不等于可复制机会。",
			"每个结论记录来源 URL、发布日期或抓取时间、地区和证据限制。"
		],
		warnings: input.goal?.trim() ? [] : ["尚未明确研究目标；默认同时观察需求、市场和商业化线索。"]
	};
}
function component(id, label, score, maxScore, observed, explanation) {
	return {
		id,
		label,
		score,
		maxScore,
		observed,
		explanation
	};
}
function repeatScore(repeatCount) {
	if (repeatCount >= 5) return 10;
	if (repeatCount >= 3) return 8;
	if (repeatCount >= 2) return 5;
	if (repeatCount >= 1) return 2;
	return 0;
}
function crossSourceScore(signal, signals) {
	const related = signals.filter((candidate) => candidate.user === signal.user && candidate.scene === signal.scene);
	const distinct = new Set(related.map((candidate) => candidate.sourceUrl || `${candidate.sourceType}:${candidate.source}`)).size;
	if (distinct >= 3) return {
		score: 15,
		explanation: "同一用户/场景下有至少三个可区分来源或来源类型。"
	};
	if (distinct >= 2) return {
		score: 8,
		explanation: "同一用户/场景下有两个可区分来源或来源类型。"
	};
	return {
		score: 0,
		explanation: "暂未形成跨来源复核。"
	};
}
function scoreSignalEvidence(signal, signals = [signal]) {
	const crossSource = crossSourceScore(signal, signals);
	const components = [
		component("behavior", "具体行为", signal.behavior ? 20 : 0, 20, Boolean(signal.behavior), signal.behavior ? "记录了用户实际做过什么。" : "缺少最近一次真实行为或关键事件。"),
		component("workaround", "当前 workaround", signal.workaround ? 15 : 0, 15, Boolean(signal.workaround), signal.workaround ? "记录了用户现在如何绕路解决。" : "还不知道用户目前如何解决。"),
		component("cost", "时间/金钱/风险代价", signal.cost ? 15 : 0, 15, Boolean(signal.cost), signal.cost ? "有明确代价描述。" : "没有量化或具体化损失。"),
		component("payment", "支付/迁移/承诺信号", signal.paymentSignal ? 10 : 0, 10, Boolean(signal.paymentSignal), signal.paymentSignal ? "出现了付费、迁移、预订或时间承诺。" : "尚无商业或承诺证据。"),
		component("repeat", "重复出现", repeatScore(signal.repeatCount ?? 0), 10, (signal.repeatCount ?? 0) >= 2, (signal.repeatCount ?? 0) >= 2 ? `重复提及约 ${signal.repeatCount} 次。` : "重复性不足或未记录。"),
		component("source", "可追溯来源", signal.sourceUrl ? 10 : 0, 10, Boolean(signal.sourceUrl), signal.sourceUrl ? "可以回到原始页面或访谈记录。" : "缺少可追溯 URL 或记录位置。"),
		component("why-now", "为什么是现在", signal.whyNow ? 5 : 0, 5, Boolean(signal.whyNow), signal.whyNow ? "记录了触发变化或时间窗口。" : "还没有解释触发因素或时间窗口。"),
		component("cross-source", "跨来源复核", crossSource.score, 15, crossSource.score > 0, crossSource.explanation)
	];
	const total = components.reduce((sum, item) => sum + item.score, 0);
	const max = components.reduce((sum, item) => sum + item.maxScore, 0);
	const score = Math.round(total / max * 100);
	const strength = score >= 70 ? "strong" : score >= 45 ? "medium" : "weak";
	const demandStage = signal.paymentSignal ? "commercial-signal" : signal.behavior && signal.workaround && (signal.repeatCount ?? 0) >= 2 ? "behavior-backed" : signal.sourceUrl || signal.behavior || signal.workaround ? "problem-signal" : "inspiration";
	const missing = components.filter((item) => !item.observed).map((item) => item.label);
	const reasons = components.filter((item) => item.observed).map((item) => item.explanation);
	const warnings = [...signal.sourceType === "community" || signal.sourceType === "review" ? ["公开讨论或评论需要第二来源复核，不能直接代表整个市场。"] : [], ...signal.paymentSignal ? [] : ["尚无支付、迁移或明确承诺证据。"]];
	return {
		signalId: signal.id,
		score,
		strength,
		demandStage,
		components,
		missing,
		reasons,
		warnings
	};
}
function scoreSignalSet(signals) {
	const scores = signals.map((signal) => scoreSignalEvidence(signal, signals));
	return {
		scores,
		summary: {
			count: scores.length,
			strong: scores.filter((item) => item.strength === "strong").length,
			medium: scores.filter((item) => item.strength === "medium").length,
			weak: scores.filter((item) => item.strength === "weak").length,
			commercialSignals: scores.filter((item) => item.demandStage === "commercial-signal").length,
			crossValidated: scores.filter((item) => item.components.some((component$1) => component$1.id === "cross-source" && component$1.observed)).length
		},
		warnings: signals.length === 0 ? ["没有可评分的 signal；先导入或提炼外部来源中的具体行为。"] : ["证据评分用于排序和暴露缺口，不等于市场规模、支付意愿或产品市场匹配。"]
	};
}
const interviewQuestions = {
	jtbd: [
		"请讲最近一次你需要完成这件事的完整过程。",
		"当时发生了什么触发事件？你想推进什么进展？",
		"你先做了什么，之后又做了什么？哪里最费力或不确定？",
		"你现在用哪些产品、人工方法或替代方案？",
		"如果换方案，你最担心什么？什么结果会让你觉得值得？"
	],
	"mom-test": [
		"最近一次遇到这个问题是什么时候？请从头讲一遍。",
		"你当时花了多少时间、钱或人力？",
		"你试过哪些解决方式？为什么没有继续？",
		"这个问题多久发生一次？上一次是什么时候？",
		"谁还会受到影响？谁参与决定或付费？"
	],
	switching: [
		"是什么事件让你开始寻找替代方案？",
		"原方案哪里让你失望或无法继续？",
		"什么因素吸引你尝试新方案？什么让你犹豫？",
		"迁移过程中付出了什么成本？最终如何做决定？",
		"还有哪些人或场景没有迁移？为什么？"
	],
	"critical-event": [
		"请描述最近一次问题真正影响结果的事件。",
		"问题发生前、发生时、发生后分别做了什么？",
		"当时谁发现了问题，谁承担了后果？",
		"你如何判断事情是否解决？",
		"如果下次再发生，哪些条件会让你提前处理？"
	]
};
function buildInterviewGuide(input) {
	const labels = {
		jtbd: "JTBD 进展访谈",
		"mom-test": "The Mom Test 非引导式访谈",
		switching: "Switching 切换访谈",
		"critical-event": "关键事件访谈"
	};
	const focus = [
		input.targetUser,
		input.scene,
		input.job
	].filter(Boolean).join(" / ");
	return {
		method: input.method,
		title: labels[input.method],
		objective: `围绕${focus || "目标场景"}，还原真实行为、当前替代方案、代价和触发变化，而不是收集功能愿望。`,
		opening: `我正在研究${focus || "这个场景"}，不会向你推销方案。请只讲最近真实发生过的经历；如果没有发生过，也请直接说没有。`,
		questions: [...interviewQuestions[input.method], ...input.knownSignal ? [`针对已知信号“${input.knownSignal}”，请讲一个最近发生的具体例子。`] : []],
		captureFields: [
			"原话和最近一次事件",
			"触发因素/为什么是现在",
			"步骤和实际行为",
			"当前 workaround/替代方案",
			"时间、金钱、风险和情绪代价",
			"使用者、决策者、付费者",
			"继续测试、迁移或付费承诺",
			"仍需交叉验证的假设"
		],
		avoid: [
			"不要先展示完整方案或功能清单。",
			"不要把“听起来不错”当成需求证据。",
			"不要只访谈满意用户；优先包含流失、迁移和人工 workaround 用户。",
			"不要记录超出研究所需的个人敏感信息。"
		],
		nextActions: [
			"将访谈整理为 signal card，并保留原话、日期和来源。",
			"用 idea_evidence_score 判断证据缺口。",
			"至少和一个公开来源或第二位用户交叉验证，再进入机会树。"
		]
	};
}
function buildOpportunitySolutionTree(review, goal) {
	const opportunities = review.opportunityMap.themes.map((theme) => {
		const candidates = review.candidates.filter((candidate) => candidate.themeId === theme.id);
		return {
			id: theme.id,
			title: theme.title,
			evidenceScore: theme.evidenceScore,
			signalCount: theme.signalCount,
			problems: theme.representativeProblems,
			solutions: candidates.map((candidate) => ({
				id: candidate.id,
				title: candidate.title,
				assumption: candidate.riskiestAssumption,
				experiment: buildExperiment(candidate)
			}))
		};
	});
	const outcome = goal?.trim() || "在外部目标市场中找到一个有真实行为证据、可触达且能在 7 天内验证的机会。";
	return {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		goal: goal?.trim() || "外部机会与真实需求发现",
		outcome,
		opportunities,
		openQuestions: [
			"哪些机会已经有跨来源证据，哪些仍只有单条公开信号？",
			"目标用户现在付出了什么成本，为什么还没有采用更好的替代方案？",
			"哪个候选解法可以用人工服务、原型或预售在 7 天内证伪？",
			"谁可以最快被触达，谁拥有预算或决策权？"
		],
		warnings: [...opportunities.length === 0 ? ["没有机会主题；先补充外部信号或用户访谈。"] : [], "机会树中的解法仍是候选假设，不代表需求或支付意愿已经成立。"],
		nextActions: opportunities.length > 0 ? [
			"选择证据最强且验证成本最低的机会。",
			"对一个候选解法运行 idea_experiment_plan。",
			"实验后记录继续、调整或暂停的决策。"
		] : ["先运行 idea_source_plan 或 idea_opportunity_radar，收集至少两个来源类型的外部信号。"]
	};
}

//#endregion
//#region src/reports.ts
function bullet(value) {
	return `- ${value.replace(/\r?\n/g, " ")}`;
}
function renderIdeaReport(review) {
	const recommended = review.recommendedCandidate;
	const lines = [
		"# Idea Discovery Review",
		"",
		`- Generated at: ${review.generatedAt}`,
		`- Source: ${review.source}`,
		`- Signals selected: ${review.signalImport.signals.length}`,
		`- Filter: ${JSON.stringify(review.filter)}`,
		"",
		"## Answer first",
		"",
		recommended ? `先验证：**${recommended.title}**。原因是问题证据 ${recommended.score.evidence}/5，下一步测试成本低，且当前结果仍保留了未验证假设。` : "当前没有足够 signal 形成可推荐的候选 idea。",
		"",
		"## Evidence quality",
		"",
		bullet(`Strong: ${review.quality.strongSignals}`),
		bullet(`Medium: ${review.quality.mediumSignals}`),
		bullet(`Weak: ${review.quality.weakSignals}`),
		...review.quality.evidenceGaps.length > 0 ? [bullet(`Gaps: ${review.quality.evidenceGaps.join(", ")}`)] : [],
		"",
		"## Opportunity themes",
		""
	];
	for (const theme of review.opportunityMap.themes) {
		lines.push(`### ${theme.title}`);
		lines.push("");
		lines.push(bullet(theme.opportunity));
		lines.push(bullet(`Signals: ${theme.signalCount}; repeated mentions: ${theme.totalRepeatCount}; evidence: ${theme.evidenceScore}/100`));
		for (const problem of theme.representativeProblems) lines.push(bullet(`Problem: ${problem}`));
		for (const risk of theme.risks) lines.push(bullet(`Risk: ${risk}`));
		lines.push("");
	}
	lines.push("## Candidate ideas", "");
	for (const candidate of review.candidates.slice(0, 10)) {
		lines.push(`### ${candidate.title}`);
		lines.push("");
		lines.push(bullet(candidate.solution));
		lines.push(bullet(`Riskiest assumption: ${candidate.riskiestAssumption}`));
		lines.push(bullet(`Next test: ${candidate.nextTest}`));
		lines.push("");
	}
	if (review.experiment) {
		lines.push("## Recommended experiment", "");
		lines.push(bullet(`Method: ${review.experiment.method}`));
		lines.push(bullet(`Audience: ${review.experiment.audience}`));
		lines.push(bullet(`Success threshold: ${review.experiment.successThreshold}`));
		lines.push(bullet(`Failure threshold: ${review.experiment.failureThreshold}`));
		lines.push(bullet(`Decision: ${review.experiment.decisionRule}`));
	}
	if (review.warnings.length > 0) {
		lines.push("", "## Warnings", "");
		for (const warning of review.warnings) lines.push(bullet(warning));
	}
	lines.push("", "## Next actions", "");
	for (const action of review.nextActions) lines.push(bullet(action));
	return `${lines.join("\n")}\n`;
}

//#endregion
//#region src/output.ts
const resultSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		ok: { type: "boolean" },
		data: { type: "json" },
		warnings: {
			type: "array",
			items: { type: "string" }
		},
		assumptions: {
			type: "array",
			items: { type: "string" }
		},
		lineage: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: true
			}
		},
		nextActions: {
			type: "array",
			items: { type: "string" }
		}
	}
};
function resultEnvelope(options) {
	return {
		ok: true,
		data: options.data,
		warnings: [...options.warnings ?? []],
		assumptions: [...options.assumptions ?? []],
		lineage: [...options.lineage ?? []],
		nextActions: [...options.nextActions ?? []]
	};
}
function jsonValue(value) {
	return JSON.parse(JSON.stringify(value));
}
function renderResult(value, maxChars) {
	const text = JSON.stringify(value, null, 2);
	return [{
		type: "text",
		text: text.length > maxChars ? `${text.slice(0, maxChars)}\n... result truncated by dsh-idea; use a narrower filter or source ...` : text
	}];
}

//#endregion
//#region src/onboarding.ts
function buildIdeaOnboarding(options) {
	const { root, scan, signals, signalWarnings } = options;
	const supportedFiles = scan.files.filter((file) => file.status === "supported");
	const signalFiles = supportedFiles.filter((file) => /signal|pain|idea|opportunity|需求|痛点|创意/i.test(file.path)).length;
	const sourceTypes = [...new Set(signals.map((signal) => signal.sourceType))];
	const strong = signals.filter((signal) => signal.evidenceStrength === "strong").length;
	const qualityScore = signals.length > 0 ? Math.round(strong / signals.length * 100) : 0;
	const dimensions = [
		{
			id: "context",
			label: "发现边界",
			status: signals.some((signal) => signal.user || signal.scene) ? "ready" : "partial",
			score: signals.length > 0 && signals.some((signal) => signal.user || signal.scene) ? 80 : 30,
			evidence: signals.some((signal) => signal.user || signal.scene) ? ["Signals contain target-user or scene fields."] : [],
			missing: signals.some((signal) => signal.user || signal.scene) ? [] : ["补充目标用户、场景或主题。"],
			nextAction: "明确目标用户、触发场景、时间范围和约束。"
		},
		{
			id: "signals",
			label: "问题信号",
			status: signals.length > 0 ? "ready" : "missing",
			score: signals.length > 0 ? Math.min(100, 40 + signals.length * 5) : 0,
			evidence: signals.length > 0 ? [`读取到 ${signals.length} 条可用 signal。`, `来源类型：${sourceTypes.join(", ") || "未标注"}`] : [],
			missing: signals.length > 0 ? [] : ["导入访谈、客服、社区、评论或研究记录。"],
			nextAction: "先收集具体行为和当前替代方案，不要先写功能列表。"
		},
		{
			id: "evidence",
			label: "证据质量",
			status: signals.length === 0 ? "missing" : qualityScore >= 60 ? "ready" : "partial",
			score: signals.length === 0 ? 0 : qualityScore,
			evidence: strong > 0 ? [`${strong} 条 signal 具备较强可追溯证据。`] : [],
			missing: signals.length === 0 ? ["没有 signal 可评估。"] : qualityScore >= 60 ? [] : ["补充来源、原话、具体行为、workaround 或代价。"],
			nextAction: "给每条 signal 补来源、日期、行为、代价和重复出现情况。"
		},
		{
			id: "opportunity",
			label: "机会综合",
			status: signals.length >= 3 ? "ready" : signals.length > 0 ? "partial" : "missing",
			score: signals.length >= 3 ? 80 : signals.length > 0 ? 40 : 0,
			evidence: signals.length >= 3 ? ["有足够 signal 开始按用户和场景聚类。"] : [],
			missing: signals.length >= 3 ? [] : ["至少准备 3 条可比较的 signal，再形成机会主题。"],
			nextAction: "运行机会映射，区分问题主题、候选解法和验证实验。"
		},
		{
			id: "validation",
			label: "验证准备",
			status: "partial",
			score: 35,
			evidence: [],
			missing: ["尚未记录最危险假设、成功阈值和失败阈值。"],
			nextAction: "为证据最强的机会生成 48 小时或 7 天实验。"
		}
	];
	const overallScore = Math.round(dimensions.reduce((sum, dimension) => sum + (dimension.score ?? 0), 0) / dimensions.length);
	const overallStatus = signals.length === 0 ? "blocked" : overallScore >= 70 ? "ready" : "partial";
	const steps = [
		{
			id: "context",
			order: 1,
			status: dimensions[0]?.status ?? "missing",
			objective: "明确目标用户、场景、主题和约束。",
			tool: "idea_onboarding",
			prompt: "定义我要研究谁、在什么场景下遇到什么问题。"
		},
		{
			id: "signals",
			order: 2,
			status: dimensions[1]?.status ?? "missing",
			objective: "收集和规范化真实问题信号。",
			tool: "idea_signal_import / idea_signal_filter",
			prompt: "导入并筛选访谈、社区、客服或评论信号。"
		},
		{
			id: "synthesis",
			order: 3,
			status: dimensions[3]?.status ?? "missing",
			objective: "将相似信号聚成机会主题。",
			tool: "idea_opportunity_map",
			prompt: "按用户和场景形成机会解法树的上半部分。"
		},
		{
			id: "validation",
			order: 4,
			status: dimensions[4]?.status ?? "partial",
			objective: "找出最危险假设并设计最小实验。",
			tool: "idea_experiment_plan",
			prompt: "为优先机会生成一个不依赖完整开发的实验。"
		},
		{
			id: "review",
			order: 5,
			status: overallStatus === "ready" ? "ready" : "partial",
			objective: "回顾证据、决策和下一步。",
			tool: "idea_review",
			prompt: "输出证据、机会、候选 idea 和继续/调整/暂停决策。"
		}
	];
	const currentStep = steps.find((step) => step.status === "missing" || step.status === "partial")?.id ?? "review";
	return {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		root,
		overallStatus,
		overallScore,
		sources: {
			files: supportedFiles.length,
			signalFiles,
			signals: signals.length,
			sourceTypes
		},
		dimensions,
		sop: {
			currentStep,
			steps
		},
		topActions: signals.length === 0 ? ["导入一份包含 problem/pain/痛点 字段的 Markdown、CSV、JSON 或 JSONL 文件。", "补充目标用户、场景和来源链接。"] : ["先运行 idea_opportunity_map，观察重复的用户/场景主题。", "为证据最强的主题运行 idea_experiment_plan。"],
		questions: signals.length === 0 ? [
			"你要研究哪类用户？",
			"他们在什么具体场景中遇到问题？",
			"目前用什么 workaround？"
		] : ["哪些 signal 来自最近的真实行为？", "哪个机会主题最容易在 7 天内验证？"],
		warnings: [
			...scan.errors,
			...signalWarnings,
			...scan.skippedFiles > 0 ? [`Skipped ${scan.skippedFiles} unsupported files.`] : []
		]
	};
}

//#endregion
//#region src/vault.ts
const supported = new Set([
	".md",
	".mdown",
	".markdown",
	".csv",
	".tsv",
	".json",
	".jsonl",
	".ndjson"
]);
function childPath(parent, name$1) {
	return `${parent.replace(/[\\/]+$/, "")}\\${name$1}`;
}
function extension(path) {
	return path.match(/\.[^.\\/]+$/)?.[0]?.toLowerCase() ?? "";
}
async function scanIdeaVault(fs, root, config, signal) {
	const target = await fs.resolve(root, { signal });
	const files = [];
	const errors = [];
	let skippedFiles = 0;
	const walk = async (currentPath, currentTarget) => {
		if (files.length >= config.maxFiles) return;
		let entries;
		try {
			entries = await fs.listDir(currentTarget, signal);
		} catch (error) {
			errors.push(`${currentPath}: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		for (const entry of entries) {
			if (files.length >= config.maxFiles) break;
			const path = childPath(currentPath, entry.name);
			if (entry.type === "directory") {
				if (entry.name.startsWith(".")) continue;
				await walk(path, entry.target);
				continue;
			}
			const ext = extension(entry.name);
			if (!supported.has(ext)) {
				skippedFiles += 1;
				continue;
			}
			if ((entry.size ?? 0) > config.maxFileBytes) {
				files.push({
					path,
					extension: ext,
					size: entry.size ?? 0,
					status: "skipped",
					reason: `exceeds maxFileBytes (${config.maxFileBytes})`
				});
				continue;
			}
			files.push({
				path,
				extension: ext,
				size: entry.size ?? 0,
				status: "supported"
			});
		}
	};
	await walk(root, target);
	return {
		root,
		files,
		skippedFiles,
		errors
	};
}

//#endregion
//#region src/web.ts
function decodeEntities(value) {
	return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, "\"").replace(/&#39;/gi, "'");
}
function cleanText(value) {
	return decodeEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}
function metaContent(html, name$1) {
	const pattern = new RegExp(`<meta[^>]+(?:name|property)=["']${name$1}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i");
	const reversePattern = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name$1}["'][^>]*>`, "i");
	return cleanText(pattern.exec(html)?.[1] ?? reversePattern.exec(html)?.[1] ?? "");
}
function htmlSnapshot(html, maxChars) {
	return {
		title: cleanText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ""),
		description: metaContent(html, "description"),
		headings: [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((match) => cleanText(match[1] ?? "")).filter(Boolean).slice(0, 20),
		excerpt: cleanText(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")).slice(0, maxChars)
	};
}
function inferSourceType(url, requested) {
	if (requested) return requested;
	const host = new URL(url).hostname.toLowerCase();
	if (host.includes("reddit") || host.includes("news.ycombinator") || host.includes("forum")) return "community";
	if (host.includes("github")) return "issue";
	if (host.includes("g2") || host.includes("capterra") || host.includes("appstore")) return "review";
	if (host.includes("trends") || host.includes("explodingtopics")) return "search";
	if (host.includes("competitor")) return "competitor";
	return "other";
}
async function fetchExternalSources(web, urls, config, requestedSourceType, signal) {
	const uniqueUrls = [...new Set(urls.map((url) => url.trim()).filter(Boolean))].slice(0, config.maxExternalUrls);
	const warnings = [];
	const sources = [];
	for (const url of uniqueUrls) {
		let parsed;
		try {
			parsed = new URL(url);
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("only HTTP(S) URLs are supported");
		} catch (error) {
			warnings.push(`Skipped invalid external URL '${url}': ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		try {
			const result = await web.fetch({ url: parsed.toString() }, signal);
			const html = result.body.content;
			const extracted = result.body.kind === "html" ? htmlSnapshot(html, config.maxExternalChars) : {
				title: "",
				description: "",
				headings: [],
				excerpt: cleanText(html).slice(0, config.maxExternalChars)
			};
			sources.push({
				url: parsed.toString(),
				finalUrl: result.url,
				statusCode: result.statusCode,
				sourceType: inferSourceType(parsed.toString(), requestedSourceType),
				fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
				...extracted,
				contentKind: result.body.kind,
				truncated: Boolean(result.truncated) || html.length > config.maxExternalChars,
				warnings: result.statusCode >= 400 ? [`HTTP status ${result.statusCode}`] : []
			});
		} catch (error) {
			warnings.push(`Could not fetch '${parsed.toString()}': ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (urls.length > config.maxExternalUrls) warnings.push(`Only the first ${config.maxExternalUrls} external URLs were scanned.`);
	return {
		sources,
		warnings
	};
}

//#endregion
//#region src/tools.ts
function ideaOutput(maxChars) {
	return {
		schema: resultSchema,
		render: (_args, value) => renderResult(value, maxChars)
	};
}
function wrapResult(value, options = {}) {
	const warnings = typeof value === "object" && value !== null && "warnings" in value && Array.isArray(value.warnings) ? value.warnings.filter((warning) => typeof warning === "string") : [];
	return resultEnvelope({
		data: jsonValue(value),
		warnings,
		assumptions: options.assumptions,
		lineage: options.lineage,
		nextActions: options.nextActions
	});
}
function ensureInsideRoot(fs, config, path, signal) {
	return Promise.all([fs.resolve(config.defaultRoot, { signal }), fs.resolve(path, { signal })]).then(([root, target]) => {
		if (!fs.contains(root, target)) throw new Error(`Path is outside configured defaultRoot: ${path}`);
	});
}
function filterFromArgs(args) {
	return {
		...args.query?.trim() ? { query: args.query.trim() } : {},
		...args.user?.trim() ? { user: args.user.trim() } : {},
		...args.scene?.trim() ? { scene: args.scene.trim() } : {},
		...args.sourceType ? { sourceType: args.sourceType } : {},
		...args.minPain !== void 0 ? { minPain: args.minPain } : {},
		...args.minRepeat !== void 0 ? { minRepeat: args.minRepeat } : {},
		...args.since?.trim() ? { since: args.since.trim() } : {},
		sort: args.sort ?? "verifiable",
		...args.limit !== void 0 ? { limit: args.limit } : {}
	};
}
function emitStarted(ctx, kind, source) {
	ctx.emit("idea/analysis-started", {
		kind,
		...source ? { source } : {}
	});
}
function emitCompleted(ctx, kind, source, warningCount) {
	ctx.emit("idea/analysis-completed", {
		kind,
		...source ? { source } : {},
		warningCount
	});
}
function candidateFromJson(value) {
	let parsed;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error("candidateJson must be valid JSON returned by idea_candidate_draft or idea_review.");
	}
	const data = typeof parsed === "object" && parsed !== null && "data" in parsed ? parsed.data : parsed;
	const candidate = Array.isArray(data) ? data[0] : data;
	if (typeof candidate !== "object" || candidate === null || !("id" in candidate) || !("title" in candidate)) throw new Error("candidateJson must contain one idea candidate object.");
	return candidate;
}
function reviewFromJson(value) {
	let parsed;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error("reviewJson must be valid JSON returned by idea_review.");
	}
	const data = typeof parsed === "object" && parsed !== null && "data" in parsed ? parsed.data : parsed;
	if (typeof data !== "object" || data === null || !("opportunityMap" in data) || !("signalImport" in data) || !("candidates" in data)) throw new Error("reviewJson must contain an idea_review result.");
	return data;
}
function signalRecordsFromJson(value) {
	let parsed;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error("signalsJson must be valid JSON returned by idea_signal_import, idea_signal_filter or another source.");
	}
	const unwrapped = typeof parsed === "object" && parsed !== null && "data" in parsed ? parsed.data : parsed;
	const candidate = Array.isArray(unwrapped) ? unwrapped : typeof unwrapped === "object" && unwrapped !== null && "signals" in unwrapped ? unwrapped.signals : void 0;
	if (!Array.isArray(candidate)) throw new Error("signalsJson must contain an array of signals or a result object with a signals array.");
	const normalized = normalizeSignals(candidate.filter((item) => typeof item === "object" && item !== null && !Array.isArray(item)), "signalsJson");
	return {
		signals: normalized.signals,
		warnings: normalized.skipped > 0 ? [`Skipped ${normalized.skipped} records without a problem/title.`] : []
	};
}
function discoverySourceIds(values) {
	const supported$1 = new Set([
		"product-hunt",
		"trustmrr",
		"reddit",
		"g2",
		"github",
		"google-trends",
		"app-reviews",
		"job-boards",
		"policy"
	]);
	const ids = values?.filter((value) => supported$1.has(value));
	return ids && ids.length > 0 ? [...new Set(ids)] : void 0;
}
function isInterviewMethod(value) {
	return value === "jtbd" || value === "mom-test" || value === "switching" || value === "critical-event";
}
function registerIdeaTools(ctx, config, service, fs, web) {
	ctx.tools.register(defineTool({
		name: "idea_external_scan",
		description: "Scan user-selected public HTTP(S) pages for external opportunity and unmet-need signals. Uses anonymous public fetch only, returns bounded source snapshots and evidence limits, and does not claim demand from page popularity.",
		parameters: {
			urls: {
				type: "array",
				required: true,
				items: { type: "string" },
				description: "One to five public HTTP(S) URLs: community threads, reviews, issue pages, trend pages, competitor pages or research reports."
			},
			sourceType: {
				type: "string",
				enum: [
					"interview",
					"support",
					"community",
					"review",
					"issue",
					"search",
					"competitor",
					"survey",
					"other"
				],
				description: "Optional source classification applied to all supplied URLs."
			},
			focus: {
				type: "string",
				description: "Optional research focus, such as a target user, scene or job. It is returned as a synthesis instruction; it does not alter page content."
			}
		},
		output: ideaOutput(config.maxResultChars),
		async execute(args, exec) {
			emitStarted(ctx, "external-scan");
			const fetched = await fetchExternalSources(web, args.urls, config, args.sourceType, exec.signal);
			const result = {
				externalFirst: true,
				focus: args.focus?.trim() || void 0,
				sources: fetched.sources,
				warnings: fetched.warnings,
				synthesisInstructions: [
					"从每个来源提取具体用户、触发场景、行为、当前 workaround 和代价。",
					"按用户 × 场景聚类为机会主题，不要把页面标题或抱怨直接写成需求结论。",
					"对每个机会标注来源 URL、抓取时间、证据强度和仍需验证的假设。",
					...args.focus?.trim() ? [`优先围绕研究焦点“${args.focus.trim()}”筛选相关信号。`] : []
				],
				nextActions: fetched.sources.length > 0 ? ["根据 source snapshots 提炼外部 signal cards，再运行 idea_candidate_draft 或 idea_experiment_plan。"] : ["检查 URL 是否公开可访问，或将外部页面导出为 Markdown/CSV/JSON 后运行 idea_signal_import。"]
			};
			emitCompleted(ctx, "external-scan", void 0, result.warnings.length);
			return wrapResult(result, {
				lineage: fetched.sources.map((source) => ({ source: source.finalUrl ?? source.url })),
				nextActions: result.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "idea_source_plan",
		description: "Create an external-first research plan for a topic. Recommends where to look, what to search, what evidence to inspect and which platform biases to keep visible. Does not claim that a source proves demand.",
		parameters: {
			topic: {
				type: "string",
				required: true,
				description: "Opportunity topic, market change or user problem to investigate."
			},
			targetUser: {
				type: "string",
				description: "Optional target role or segment."
			},
			market: {
				type: "string",
				description: "Optional industry or market category."
			},
			region: {
				type: "string",
				description: "Optional country, region or language boundary."
			},
			goal: {
				type: "string",
				description: "Optional research goal, such as finding a paid niche or understanding unmet needs."
			},
			sourceIds: {
				type: "array",
				items: { type: "string" },
				description: "Optional source ids: product-hunt, trustmrr, reddit, g2, github, google-trends, app-reviews, job-boards, policy."
			}
		},
		output: ideaOutput(config.maxResultChars),
		async execute(args) {
			return wrapResult(buildSourcePlan({
				topic: args.topic,
				targetUser: args.targetUser,
				market: args.market,
				region: args.region,
				goal: args.goal,
				sourceIds: discoverySourceIds(args.sourceIds)
			}), { nextActions: ["按 source plan 选择至少两个来源类型，再运行 idea_opportunity_radar 或 idea_external_scan。"] });
		}
	}));
	ctx.tools.register(defineTool({
		name: "idea_opportunity_radar",
		description: "Build an external opportunity radar: recommend public sources and search recipes, optionally fetch user-provided public URLs, and return the evidence gate for turning market signals into opportunity themes. It never performs unrestricted crawling or treats popularity as demand.",
		parameters: {
			topic: {
				type: "string",
				required: true,
				description: "Opportunity topic, market change or user problem to investigate."
			},
			targetUser: {
				type: "string",
				description: "Optional target role or segment."
			},
			market: {
				type: "string",
				description: "Optional industry or market category."
			},
			region: {
				type: "string",
				description: "Optional country, region or language boundary."
			},
			goal: {
				type: "string",
				description: "Optional research goal."
			},
			sourceIds: {
				type: "array",
				items: { type: "string" },
				description: "Optional source ids from idea_source_plan."
			},
			urls: {
				type: "array",
				items: { type: "string" },
				description: "Optional user-selected public HTTP(S) pages to snapshot; limited by maxExternalUrls."
			}
		},
		output: ideaOutput(config.maxResultChars),
		async execute(args, exec) {
			emitStarted(ctx, "opportunity-radar");
			const plan = buildSourcePlan({
				topic: args.topic,
				targetUser: args.targetUser,
				market: args.market,
				region: args.region,
				goal: args.goal,
				sourceIds: discoverySourceIds(args.sourceIds)
			});
			const fetched = args.urls?.length ? await fetchExternalSources(web, args.urls, config, void 0, exec.signal) : {
				sources: [],
				warnings: []
			};
			const result = {
				externalFirst: true,
				request: {
					topic: args.topic,
					targetUser: args.targetUser,
					market: args.market,
					region: args.region,
					goal: args.goal
				},
				sourcePlan: plan.sources,
				researchSequence: plan.researchSequence,
				evidenceGate: plan.evidenceGate,
				snapshots: fetched.sources,
				warnings: [...plan.warnings, ...fetched.warnings],
				synthesisContract: [
					"先提取用户、触发场景、具体行为、当前 workaround、代价和为什么是现在。",
					"按用户 × 场景 × Job 聚类，不要把一个产品发布或一条抱怨直接写成需求结论。",
					"至少比较两个不同来源类型；分别标记事实、信号、推断和假设。",
					"对候选机会运行 idea_evidence_score，并为最高风险假设设计 48 小时或 7 天实验。"
				],
				nextActions: fetched.sources.length > 0 ? ["把 snapshots 提炼成 signal cards，运行 idea_evidence_score，再运行 idea_opportunity_map 或 idea_review。"] : ["按 sourcePlan 打开并选择公开页面，再把 URL 交给 idea_external_scan 或本工具。"]
			};
			emitCompleted(ctx, "opportunity-radar", void 0, result.warnings.length);
			return wrapResult(result, {
				lineage: fetched.sources.map((source) => ({ source: source.finalUrl ?? source.url })),
				nextActions: result.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "idea_onboarding",
		description: "Run a read-only idea-discovery readiness check on the configured local workspace. Finds supported signal files, evidence quality gaps and the next discovery step.",
		parameters: { root: {
			type: "string",
			description: "Optional directory under defaultRoot."
		} },
		output: ideaOutput(config.maxResultChars),
		async execute(args, exec) {
			const root = args.root?.trim() || config.defaultRoot;
			await ensureInsideRoot(fs, config, root, exec.signal);
			emitStarted(ctx, "onboarding", root);
			const scan = await scanIdeaVault(fs, root, config, exec.signal);
			const signals = [];
			const warnings = [...scan.errors];
			for (const file of scan.files.filter((item) => item.status === "supported")) try {
				await ensureInsideRoot(fs, config, file.path, exec.signal);
				const imported = await service.importSignals(file.path, exec.signal);
				signals.push(...imported.signals);
				warnings.push(...imported.warnings);
			} catch (error) {
				warnings.push(`Skipped ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
			}
			const result = buildIdeaOnboarding({
				root,
				scan,
				signals,
				signalWarnings: warnings
			});
			emitCompleted(ctx, "onboarding", root, result.warnings.length);
			return wrapResult(result, {
				lineage: [{ source: root }],
				nextActions: result.topActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "idea_signal_import",
		description: "Import a local Markdown, CSV, TSV, JSON or JSONL file as normalized pain-point signals. Reads only and preserves source lineage.",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "Signal file under defaultRoot."
			},
			limit: {
				type: "integer",
				description: "Optional maximum number of normalized signals to return; defaults to 100."
			}
		},
		output: ideaOutput(config.maxResultChars),
		async execute(args, exec) {
			await ensureInsideRoot(fs, config, args.path, exec.signal);
			emitStarted(ctx, "signal-import", args.path);
			const imported = await service.importSignals(args.path, exec.signal);
			const limit = Math.max(1, Math.min(500, args.limit ?? 100));
			const result = {
				...imported,
				signals: imported.signals.slice(0, limit)
			};
			emitCompleted(ctx, "signal-import", args.path, result.warnings.length);
			return wrapResult(result, {
				lineage: [{ source: args.path }],
				nextActions: ["运行 idea_signal_filter，先按目标用户、场景和证据强度缩小范围。"]
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "idea_evidence_score",
		description: "Score a set of idea signals for evidence quality and demand stage. Surfaces missing behavior, workaround, cost, repeat, cross-source and commercial evidence; it is a prioritization aid, not proof of product-market fit.",
		parameters: { signalsJson: {
			type: "string",
			required: true,
			description: "JSON array of signal records or a result object containing a signals array."
		} },
		output: ideaOutput(config.maxResultChars),
		async execute(args) {
			const parsed = signalRecordsFromJson(args.signalsJson);
			const scored = scoreSignalSet(parsed.signals);
			return wrapResult({
				externalFirst: true,
				source: "signalsJson",
				signals: parsed.signals,
				scores: scored.scores,
				summary: scored.summary,
				warnings: [...parsed.warnings, ...scored.warnings],
				nextActions: scored.summary.count > 0 ? [
					"优先补齐分数最低但问题代价高的 signal。",
					"对跨来源复核且有行为/workaround 的机会运行 idea_opportunity_map。",
					"对有支付、迁移或承诺信号的方向设计最小商业验证。"
				] : ["先从 Product Hunt、TrustMRR、Reddit、G2、GitHub 或用户访谈中提炼 signal cards。"]
			}, { nextActions: ["根据证据缺口补充来源或访谈，不要直接把高分改写成市场结论。"] });
		}
	}));
	ctx.tools.register(defineTool({
		name: "idea_interview_guide",
		description: "Generate an evidence-first user-need interview guide using JTBD, The Mom Test, switching interviews or critical-event interviews. Focuses on recent behavior, workarounds, costs and triggers rather than feature opinions.",
		parameters: {
			method: {
				type: "string",
				enum: [
					"jtbd",
					"mom-test",
					"switching",
					"critical-event"
				],
				required: true
			},
			targetUser: {
				type: "string",
				required: true,
				description: "Target role or segment."
			},
			job: {
				type: "string",
				description: "Optional Job to Be Done or desired progress."
			},
			scene: {
				type: "string",
				description: "Optional trigger scene."
			},
			knownSignal: {
				type: "string",
				description: "Optional external signal to probe with a recent concrete example."
			}
		},
		output: ideaOutput(config.maxResultChars),
		async execute(args) {
			if (!isInterviewMethod(args.method)) throw new Error(`Unsupported interview method: ${args.method}`);
			const guide = buildInterviewGuide({
				method: args.method,
				targetUser: args.targetUser,
				job: args.job,
				scene: args.scene,
				knownSignal: args.knownSignal
			});
			return wrapResult({
				externalFirst: true,
				guide,
				nextActions: guide.nextActions
			}, { nextActions: guide.nextActions });
		}
	}));
	ctx.tools.register(defineTool({
		name: "idea_signal_filter",
		description: "Filter and rank normalized idea signals by keyword, target user, scene, source type, time, pain and repetition. Treats ranking as research prioritization, not demand proof.",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "Signal file under defaultRoot."
			},
			query: {
				type: "string",
				description: "Keyword matched across problem, user, scene, source, quote, workaround and tags."
			},
			user: {
				type: "string",
				description: "Target-user filter."
			},
			scene: {
				type: "string",
				description: "Pain-scenario filter."
			},
			sourceType: {
				type: "string",
				enum: [
					"interview",
					"support",
					"community",
					"review",
					"issue",
					"search",
					"competitor",
					"survey",
					"other"
				]
			},
			minPain: {
				type: "number",
				description: "Minimum pain score from 1 to 10."
			},
			minRepeat: {
				type: "number",
				description: "Minimum repeat/mention count."
			},
			since: {
				type: "string",
				description: "Only include signals on or after this ISO-like date."
			},
			sort: {
				type: "string",
				enum: [
					"latest",
					"repeat",
					"pain",
					"verifiable"
				],
				description: "Ranking mode; defaults to verifiable."
			},
			limit: {
				type: "integer",
				description: "Maximum result count; defaults to 100."
			}
		},
		output: ideaOutput(config.maxResultChars),
		async execute(args, exec) {
			await ensureInsideRoot(fs, config, args.path, exec.signal);
			const filter = filterFromArgs(args);
			emitStarted(ctx, "signal-filter", args.path);
			const selected = await service.filterSignals(args.path, filter, exec.signal);
			const result = {
				source: selected.source,
				filter,
				count: selected.signals.length,
				signals: selected.signals.map((signal) => ({
					...signal,
					quality: signalQuality(signal)
				})),
				warnings: selected.warnings,
				nextActions: ["对重复出现且可追溯的 signal 做机会聚类；不要把单条抱怨直接变成功能。"]
			};
			emitCompleted(ctx, "signal-filter", args.path, result.warnings.length);
			return wrapResult(result, {
				lineage: [{ source: args.path }],
				nextActions: result.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "idea_opportunity_map",
		description: "Cluster filtered signals by target user and pain scene into opportunity themes. Keeps representative problems, workarounds, evidence scores and risks visible.",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "Signal file under defaultRoot."
			},
			query: { type: "string" },
			user: { type: "string" },
			scene: { type: "string" },
			sourceType: {
				type: "string",
				enum: [
					"interview",
					"support",
					"community",
					"review",
					"issue",
					"search",
					"competitor",
					"survey",
					"other"
				]
			},
			minPain: { type: "number" },
			minRepeat: { type: "number" },
			since: { type: "string" },
			sort: {
				type: "string",
				enum: [
					"latest",
					"repeat",
					"pain",
					"verifiable"
				]
			},
			limit: { type: "integer" }
		},
		output: ideaOutput(config.maxResultChars),
		async execute(args, exec) {
			await ensureInsideRoot(fs, config, args.path, exec.signal);
			const filter = filterFromArgs(args);
			emitStarted(ctx, "opportunity-map", args.path);
			const selected = await service.filterSignals(args.path, filter, exec.signal);
			const map = await service.buildMap(args.path, filter, exec.signal);
			const result = {
				...map,
				filter,
				importedWarnings: selected.warnings
			};
			emitCompleted(ctx, "opportunity-map", args.path, [...map.warnings, ...selected.warnings].length);
			return wrapResult(result, {
				lineage: [{ source: args.path }],
				nextActions: map.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "idea_candidate_draft",
		description: "Draft multiple solution directions from opportunity themes. It is a hypothesis generator, not a proof of product-market fit.",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "Signal file under defaultRoot."
			},
			query: { type: "string" },
			user: { type: "string" },
			scene: { type: "string" },
			sourceType: {
				type: "string",
				enum: [
					"interview",
					"support",
					"community",
					"review",
					"issue",
					"search",
					"competitor",
					"survey",
					"other"
				]
			},
			minPain: { type: "number" },
			minRepeat: { type: "number" },
			since: { type: "string" },
			sort: {
				type: "string",
				enum: [
					"latest",
					"repeat",
					"pain",
					"verifiable"
				]
			},
			limit: { type: "integer" },
			maxPerTheme: {
				type: "integer",
				description: "Number of solution lenses per theme; defaults to 2."
			}
		},
		output: ideaOutput(config.maxResultChars),
		async execute(args, exec) {
			await ensureInsideRoot(fs, config, args.path, exec.signal);
			const filter = filterFromArgs(args);
			emitStarted(ctx, "candidate-draft", args.path);
			const result = await service.generateCandidates(args.path, filter, args.maxPerTheme ?? 2, exec.signal);
			emitCompleted(ctx, "candidate-draft", args.path, result.warnings.length);
			return wrapResult({
				...result,
				filter,
				nextActions: ["为一个候选 idea 运行 idea_experiment_plan，并先测最危险假设。"]
			}, { lineage: [{ source: args.path }] });
		}
	}));
	ctx.tools.register(defineTool({
		name: "idea_experiment_plan",
		description: "Create a small validation experiment for one candidate idea. Selects an evidence-first method and explicit success/failure thresholds.",
		parameters: { candidateJson: {
			type: "string",
			required: true,
			description: "One candidate object or an idea_review/idea_candidate_draft result JSON."
		} },
		output: ideaOutput(config.maxResultChars),
		async execute(args) {
			const candidate = candidateFromJson(args.candidateJson);
			return wrapResult({
				candidate,
				experiment: buildExperiment(candidate),
				nextActions: ["执行实验并记录原始行为、来源、日期、成功/失败阈值和决策。"]
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "idea_review",
		description: "Run the complete local idea-discovery review: import signals, apply a saved-style filter, cluster opportunities, draft candidates and produce one next experiment.",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "Signal file under defaultRoot."
			},
			query: { type: "string" },
			user: { type: "string" },
			scene: { type: "string" },
			sourceType: {
				type: "string",
				enum: [
					"interview",
					"support",
					"community",
					"review",
					"issue",
					"search",
					"competitor",
					"survey",
					"other"
				]
			},
			minPain: { type: "number" },
			minRepeat: { type: "number" },
			since: { type: "string" },
			sort: {
				type: "string",
				enum: [
					"latest",
					"repeat",
					"pain",
					"verifiable"
				]
			},
			limit: { type: "integer" },
			maxPerTheme: { type: "integer" }
		},
		output: ideaOutput(config.maxResultChars),
		async execute(args, exec) {
			await ensureInsideRoot(fs, config, args.path, exec.signal);
			const filter = filterFromArgs(args);
			emitStarted(ctx, "review", args.path);
			const imported = await service.importSignals(args.path, exec.signal);
			const selected = filterSignals(imported.signals, filter);
			const map = await service.buildMap(args.path, filter, exec.signal);
			const candidates = (await service.generateCandidates(args.path, filter, args.maxPerTheme ?? 2, exec.signal)).candidates;
			const recommendedCandidate = candidates[0];
			const quality = {
				strongSignals: selected.filter((signal) => signal.evidenceStrength === "strong").length,
				mediumSignals: selected.filter((signal) => signal.evidenceStrength === "medium").length,
				weakSignals: selected.filter((signal) => signal.evidenceStrength === "weak").length,
				evidenceGaps: [...new Set(selected.flatMap((signal) => signalQuality(signal).missing))]
			};
			const result = {
				generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
				source: args.path,
				filter,
				signalImport: {
					...imported,
					signals: selected
				},
				quality,
				opportunityMap: map,
				candidates,
				recommendedCandidate,
				experiment: recommendedCandidate ? buildExperiment(recommendedCandidate) : void 0,
				warnings: [...imported.warnings, ...map.warnings],
				nextActions: recommendedCandidate ? ["先执行推荐候选的最小实验，再决定继续、调整或暂停。"] : ["补充可用 signal 后重新运行 review。"]
			};
			emitCompleted(ctx, "review", args.path, result.warnings.length);
			return wrapResult(result, {
				lineage: [{ source: args.path }],
				nextActions: result.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "idea_ost",
		description: "Turn an idea_review result into an Opportunity Solution Tree: outcome -> opportunity -> multiple candidate solutions -> riskiest assumption -> experiment. Keeps solutions separate from unmet needs.",
		parameters: {
			reviewJson: {
				type: "string",
				required: true,
				description: "JSON returned by idea_review."
			},
			goal: {
				type: "string",
				description: "Optional external opportunity goal or target outcome."
			}
		},
		output: ideaOutput(config.maxResultChars),
		async execute(args) {
			const review = reviewFromJson(args.reviewJson);
			const tree = buildOpportunitySolutionTree(review, args.goal);
			return wrapResult({
				externalFirst: true,
				tree,
				nextActions: tree.nextActions
			}, {
				lineage: [{ source: review.source }],
				nextActions: tree.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "idea_report",
		description: "Render an idea_review result as a shareable Markdown report. Reads the supplied JSON only and does not write files.",
		parameters: { reviewJson: {
			type: "string",
			required: true,
			description: "JSON returned by idea_review."
		} },
		output: ideaOutput(config.maxResultChars),
		async execute(args) {
			const review = reviewFromJson(args.reviewJson);
			return wrapResult({
				source: review.source,
				reportMarkdown: renderIdeaReport(review),
				nextActions: review.nextActions
			}, {
				lineage: [{ source: review.source }],
				nextActions: review.nextActions
			});
		}
	}));
}

//#endregion
//#region src/index.ts
const name = "dsh-idea";
const inject = [
	"tools",
	"fs",
	"web"
];
const Config = Schema.object({
	defaultRoot: Schema.string().default("."),
	reportDir: Schema.string().default(".dsh-idea/reports"),
	maxFiles: Schema.number().step(1).min(1).max(5e3).default(500),
	maxRows: Schema.number().step(1).min(1).max(5e5).default(5e4),
	maxFileBytes: Schema.number().step(1).min(1024).max(10485760).default(1048576),
	maxTextChars: Schema.number().step(1).min(1e3).max(1e6).default(18e4),
	maxResultChars: Schema.number().step(1).min(1e3).max(2e5).default(5e4),
	defaultLanguage: Schema.string().default("zh-CN"),
	defaultSort: Schema.union([
		Schema.const("latest"),
		Schema.const("repeat"),
		Schema.const("pain"),
		Schema.const("verifiable")
	]).default("verifiable"),
	maxExternalUrls: Schema.number().step(1).min(1).max(20).default(5),
	maxExternalChars: Schema.number().step(1).min(1e3).max(1e5).default(3e4),
	requestTimeoutMs: Schema.number().step(1).min(1e3).max(12e4).default(3e4)
});
function apply(ctx, config) {
	const fs = ctx.fs;
	if (!ctx.registry.has(webFetchHttp)) ctx.plugin(webFetchHttp, {
		maxBodyChars: config.maxExternalChars,
		maxResponseBytes: 5e6,
		timeoutMs: config.requestTimeoutMs,
		maxRedirects: 5
	});
	const service = new IdeaDiscoveryService(ctx, fs, config);
	const web = ctx.web;
	registerIdeaTools(ctx, config, service, fs, web);
	console.log(`[${name}] registered idea-discovery tools for ${config.defaultRoot}`);
}

//#endregion
export { Config, apply, inject, name };
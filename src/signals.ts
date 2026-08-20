import type {
  EvidenceStrength,
  EvidenceState,
  IdeaCandidate,
  IdeaSignal,
  IdeaSolutionLens,
  OpportunityMap,
  OpportunityTheme,
  SignalFilter,
  SignalSourceType,
} from './types.js'

const aliases: Record<string, string[]> = {
  title: ['title', 'name', 'subject', '痛点标题', '标题'],
  problem: ['problem', 'pain', 'pain_point', 'painPoint', '痛点', '问题', 'content', 'text', 'description'],
  user: ['user', 'target_user', 'targetUser', 'persona', '目标用户', '用户', 'audience'],
  scene: ['scene', 'context', 'scenario', 'pain_scene', '痛点场景', '场景', '情境'],
  source: ['source', 'source_name', 'sourceName', '来源', 'channel', '社区来源'],
  sourceType: ['sourceType', 'source_type', '来源类型'],
  sourceUrl: ['sourceUrl', 'source_url', 'url', 'link', '链接', '来源链接'],
  capturedAt: ['capturedAt', 'captured_at', 'date', 'createdAt', 'created_at', 'updated', '日期', '时间'],
  quote: ['quote', 'original', 'raw', '原话', '原始证据', '原文'],
  behavior: ['behavior', 'behaviour', 'user_behavior', '行为', '用户行为'],
  workaround: ['workaround', 'alternative', 'current_solution', '当前替代', '当前方案', '替代方案'],
  cost: ['cost', 'loss', 'impact', '代价', '损失', '成本'],
  paymentSignal: ['paymentSignal', 'payment_signal', 'payment', 'commitment', '付费信号', '承诺'],
  whyNow: ['whyNow', 'why_now', 'trigger', '触发因素', '为什么是现在'],
  painScore: ['painScore', 'pain_score', 'score', 'severity', '痛苦程度', '痛苦分数', '评分'],
  repeatCount: ['repeatCount', 'repeat_count', 'mentions', 'frequency', '重复提及数', '提及数', '频率'],
  tags: ['tags', 'tag', 'labels', '标签'],
  evidenceState: ['evidenceState', 'evidence_state', '状态', '证据状态'],
}

function stringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  const text = String(value).trim()
  return text || undefined
}

function firstValue(record: Record<string, unknown>, key: keyof typeof aliases): string | undefined {
  for (const alias of aliases[key] ?? [key]) {
    const value = stringValue(record[alias])
    if (value) return value
  }
  return undefined
}

function numberValue(record: Record<string, unknown>, key: keyof typeof aliases): number | undefined {
  const raw = firstValue(record, key)
  if (!raw) return undefined
  const number = Number(raw.replace(/[^\d.-]/g, ''))
  return Number.isFinite(number) ? number : undefined
}

function parseTags(record: Record<string, unknown>): string[] {
  const raw = firstValue(record, 'tags')
  return raw ? [...new Set(raw.split(/[,，;；|/\s]+/).map((tag) => tag.trim()).filter(Boolean))] : []
}

function inferSourceType(value: string | undefined): SignalSourceType {
  const source = (value ?? '').toLowerCase()
  if (/interview|访谈|观察/.test(source)) return 'interview'
  if (/support|客服|工单/.test(source)) return 'support'
  if (/reddit|hacker|community|社区|论坛|问答/.test(source)) return 'community'
  if (/review|app.?store|评论|评价/.test(source)) return 'review'
  if (/github|issue|bug/.test(source)) return 'issue'
  if (/search|trend|搜索|趋势/.test(source)) return 'search'
  if (/competitor|竞品|替代/.test(source)) return 'competitor'
  if (/survey|问卷/.test(source)) return 'survey'
  return 'other'
}

function clamp(value: number | undefined, minimum: number, maximum: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.max(minimum, Math.min(maximum, value))
}

function strengthFor(signal: Omit<IdeaSignal, 'id' | 'evidenceStrength' | 'evidenceState'>): EvidenceStrength {
  const count = [signal.sourceUrl, signal.quote, signal.behavior, signal.workaround, signal.cost].filter(Boolean).length
  if (count >= 4 || (signal.sourceUrl && signal.behavior && (signal.repeatCount ?? 0) >= 3)) return 'strong'
  if (count >= 2 || signal.sourceUrl || signal.behavior) return 'medium'
  return 'weak'
}

function stableId(text: string, index: number): string {
  let hash = 2166136261
  for (const character of text) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return `signal-${(hash >>> 0).toString(16)}-${index + 1}`
}

export function normalizeSignal(record: Record<string, unknown>, index: number, source: string): IdeaSignal | undefined {
  const problem = firstValue(record, 'problem') ?? firstValue(record, 'title')
  if (!problem) return undefined
  const sourceName = firstValue(record, 'source') ?? source
  const base = {
    title: firstValue(record, 'title') ?? problem.slice(0, 80),
    problem,
    user: firstValue(record, 'user') ?? '',
    scene: firstValue(record, 'scene') ?? '',
    source: sourceName,
    sourceType: inferSourceType(firstValue(record, 'sourceType') ?? sourceName),
    sourceUrl: firstValue(record, 'sourceUrl'),
    capturedAt: firstValue(record, 'capturedAt'),
    quote: firstValue(record, 'quote'),
    behavior: firstValue(record, 'behavior'),
    workaround: firstValue(record, 'workaround'),
    cost: firstValue(record, 'cost'),
    paymentSignal: firstValue(record, 'paymentSignal') ?? firstValue(record, 'payment') ?? firstValue(record, 'commitment'),
    whyNow: firstValue(record, 'whyNow') ?? firstValue(record, 'why_now') ?? firstValue(record, 'trigger'),
    painScore: clamp(numberValue(record, 'painScore'), 1, 10),
    repeatCount: clamp(numberValue(record, 'repeatCount'), 1, 100_000),
    tags: parseTags(record),
    notes: firstValue(record, 'notes'),
  } satisfies Omit<IdeaSignal, 'id' | 'evidenceStrength' | 'evidenceState'>
  const evidenceStrength = strengthFor(base)
  const rawState = firstValue(record, 'evidenceState')?.toLowerCase()
  const evidenceState: EvidenceState = rawState === 'validated' || rawState === '已验证'
    ? 'validated'
    : rawState === 'inference' || rawState === '推断'
      ? 'inference'
      : 'signal'
  return { id: stableId(`${source}|${problem}`, index), ...base, evidenceStrength, evidenceState }
}

export function normalizeSignals(records: Array<Record<string, unknown>>, source: string): { signals: IdeaSignal[]; skipped: number } {
  const signals: IdeaSignal[] = []
  let skipped = 0
  for (const [index, record] of records.entries()) {
    const signal = normalizeSignal(record, index, source)
    if (!signal) skipped += 1
    else signals.push(signal)
  }
  return { signals, skipped }
}

function includes(text: string | undefined, query: string): boolean {
  return Boolean(text?.toLocaleLowerCase().includes(query))
}

function verifiability(signal: IdeaSignal): number {
  return [signal.sourceUrl, signal.quote, signal.behavior, signal.workaround, signal.cost].filter(Boolean).length * 2
    + ((signal.repeatCount ?? 0) > 0 ? 2 : 0)
    + (signal.evidenceStrength === 'strong' ? 3 : signal.evidenceStrength === 'medium' ? 1 : 0)
}

export function signalQuality(signal: IdeaSignal): { score: number; missing: string[]; reasons: string[] } {
  const missing: string[] = []
  const reasons: string[] = []
  if (!signal.sourceUrl) missing.push('sourceUrl')
  if (!signal.behavior) missing.push('behavior')
  if (!signal.workaround) missing.push('workaround')
  if (!signal.cost) missing.push('cost')
  if (!signal.whyNow) missing.push('whyNow')
  if ((signal.repeatCount ?? 0) < 2) missing.push('repeatCount')
  if (signal.sourceUrl) reasons.push('可追溯来源')
  if (signal.behavior) reasons.push('有具体行为')
  if (signal.workaround) reasons.push('记录了当前替代方案')
  if (signal.paymentSignal) reasons.push('出现支付、迁移或承诺信号')
  if (signal.whyNow) reasons.push('记录了触发变化或为什么是现在')
  if ((signal.repeatCount ?? 0) >= 2) reasons.push('有重复出现')
  return { score: Math.min(100, Math.round(verifiability(signal) * 5)), missing, reasons }
}

export function filterSignals(signals: IdeaSignal[], filter: SignalFilter = {}): IdeaSignal[] {
  const query = filter.query?.trim().toLocaleLowerCase()
  const filtered = signals.filter((signal) => {
    if (query) {
      const haystack = [signal.title, signal.problem, signal.user, signal.scene, signal.source, signal.quote, signal.workaround, ...signal.tags].join(' ').toLocaleLowerCase()
      if (!haystack.includes(query)) return false
    }
    if (filter.user && !includes(signal.user, filter.user.toLocaleLowerCase())) return false
    if (filter.scene && !includes(signal.scene, filter.scene.toLocaleLowerCase())) return false
    if (filter.sourceType && signal.sourceType !== filter.sourceType) return false
    if (filter.minPain !== undefined && (signal.painScore ?? 0) < filter.minPain) return false
    if (filter.minRepeat !== undefined && (signal.repeatCount ?? 0) < filter.minRepeat) return false
    if (filter.since && (!signal.capturedAt || signal.capturedAt < filter.since)) return false
    return true
  })
  const sorted = [...filtered].sort((left, right) => {
    if (filter.sort === 'repeat') return (right.repeatCount ?? 0) - (left.repeatCount ?? 0)
    if (filter.sort === 'pain') return (right.painScore ?? 0) - (left.painScore ?? 0)
    if (filter.sort === 'verifiable') return verifiability(right) - verifiability(left)
    return (right.capturedAt ?? '').localeCompare(left.capturedAt ?? '')
  })
  return filter.limit && filter.limit > 0 ? sorted.slice(0, Math.min(filter.limit, 500)) : sorted.slice(0, 500)
}

function themeKey(signal: IdeaSignal): string {
  return `${signal.scene.trim().toLocaleLowerCase() || '未分类场景'}|${signal.user.trim().toLocaleLowerCase() || '目标用户待确认'}`
}

function themeId(key: string): string {
  return `opportunity-${key.replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-').replace(/^-|-$/g, '').slice(0, 64) || 'unknown'}`
}

export function buildOpportunityMap(signals: IdeaSignal[], source: string): OpportunityMap {
  const groups = new Map<string, IdeaSignal[]>()
  for (const signal of signals) groups.set(themeKey(signal), [...(groups.get(themeKey(signal)) ?? []), signal])
  const themes: OpportunityTheme[] = []
  for (const [key, group] of groups) {
    const parts = key.split('|')
    const scene = parts[0] ?? '未分类场景'
    const user = parts[1] ?? '目标用户待确认'
    const averagePain = group.filter((signal) => signal.painScore !== undefined).map((signal) => signal.painScore ?? 0)
    const repeat = group.reduce((sum, signal) => sum + (signal.repeatCount ?? 1), 0)
    const quality = group.map(signalQuality)
    const evidenceScore = Math.round(quality.reduce((sum, item) => sum + item.score, 0) / Math.max(1, quality.length))
    const representativeProblems = [...new Set(group.map((signal) => signal.problem))].slice(0, 5)
    const workarounds = [...new Set(group.map((signal) => signal.workaround).filter((value): value is string => Boolean(value)))].slice(0, 5)
    themes.push({
      id: themeId(key),
      title: `${scene} × ${user}`,
      user,
      scene,
      opportunity: `帮助${user}在${scene}中更可靠、更省力地完成当前任务，减少反复、等待或出错。`,
      signalCount: group.length,
      totalRepeatCount: repeat,
      averagePainScore: averagePain.length > 0 ? Math.round((averagePain.reduce((sum, value) => sum + value, 0) / averagePain.length) * 10) / 10 : null,
      evidenceScore,
      signalIds: group.map((signal) => signal.id),
      representativeProblems,
      currentWorkarounds: workarounds,
      risks: evidenceScore < 40 ? ['证据较弱：补充行为、来源或重复出现次数。'] : ['还未验证触达、付费意愿和方案可行性。'],
    })
  }
  themes.sort((left, right) => (right.evidenceScore + right.totalRepeatCount) - (left.evidenceScore + left.totalRepeatCount))
  return {
    generatedAt: new Date().toISOString(),
    source,
    signalsConsidered: signals.length,
    themes,
    warnings: signals.length === 0 ? ['No usable signals were found; opportunity themes are unavailable.'] : [],
    nextActions: themes.length > 0
      ? ['为前两个机会主题补充同类用户访谈。', '为证据最强的主题设计一个不写完整产品的最小实验。']
      : ['导入包含 problem/pain/痛点 字段的 Markdown、CSV、JSON 或 JSONL 文件。'],
  }
}

const lenses: Array<{ lens: IdeaSolutionLens; label: string }> = [
  { lens: 'automation', label: '自动化关键重复步骤' },
  { lens: 'copilot', label: '提供情境化辅助和决策支持' },
  { lens: 'workflow', label: '重组跨工具工作流' },
  { lens: 'marketplace', label: '连接供需双方或可复用资源' },
  { lens: 'education', label: '提供结构化方法、模板与陪跑服务' },
]

export function generateCandidates(themes: OpportunityTheme[], maxPerTheme = 2): IdeaCandidate[] {
  const candidates: IdeaCandidate[] = []
  for (const theme of themes) {
    for (const [index, item] of lenses.slice(0, Math.max(1, Math.min(maxPerTheme, lenses.length))).entries()) {
      const title = `${theme.scene}场景的${item.label}`
      const problem = theme.representativeProblems[0] ?? theme.opportunity
      const confidence = theme.evidenceScore >= 70 ? 'high' : theme.evidenceScore >= 40 ? 'medium' : 'low'
      candidates.push({
        id: `idea-${theme.id.replace(/^opportunity-/, '')}-${item.lens}`,
        themeId: theme.id,
        title,
        user: theme.user,
        scene: theme.scene,
        problem,
        solutionLens: item.lens,
        solution: `围绕“${problem}”，${item.label}，先覆盖一个窄场景并保留人工兜底。`,
        whyNow: theme.totalRepeatCount > theme.signalCount ? '同类信号有重复出现，值得先验证问题强度。' : '当前信号可以作为探索入口，但还需要补充重复性和时间窗口证据。',
        evidence: [`${theme.signalCount} 条信号`, `总重复提及约 ${theme.totalRepeatCount} 次`, `证据评分 ${theme.evidenceScore}/100`],
        riskiestAssumption: `目标用户愿意改变当前 workaround，并为${item.label}投入时间、预算或承诺。`,
        score: {
          problem: theme.averagePainScore ? Math.round(theme.averagePainScore * 10) / 2 : 2,
          evidence: Math.max(1, Math.round(theme.evidenceScore / 20)),
          reachability: null,
          feasibility: null,
          testability: Math.max(1, 6 - index),
        },
        confidence,
        nextTest: confidence === 'low' ? '先做 5 次问题访谈，确认最近一次行为和当前代价。' : '用 concierge 或低保真原型测试一个真实任务。',
      })
    }
  }
  return candidates
}

export function buildExperiment(candidate: IdeaCandidate): import('./types.js').ExperimentPlan {
  const method = candidate.confidence === 'low' ? 'interview' : candidate.solutionLens === 'automation' ? 'concierge' : 'prototype'
  return {
    candidateId: candidate.id,
    hypothesis: `如果${candidate.user}在${candidate.scene}中使用“${candidate.title}”，那么他们会减少当前任务中的关键损失，并愿意继续使用或付出明确承诺。`,
    riskiestAssumption: candidate.riskiestAssumption,
    method,
    audience: candidate.user,
    steps: method === 'interview'
      ? ['招募 5 位最近遇到该场景的人。', '要求他们复盘最近一次真实经历，不展示方案。', '记录触发、步骤、替代方案和代价。', '询问他们如何判断问题已解决。']
      : ['选一个窄场景和一个可观察任务。', '用人工服务或低保真原型完成任务。', '观察用户是否主动完成关键步骤。', '访谈用户对结果、替代方案和继续使用意愿的看法。'],
    evidenceToCollect: ['最近一次真实行为', '当前 workaround 和投入成本', '是否愿意安排时间继续测试', '是否出现明确的付费、预订或转介绍承诺'],
    successThreshold: method === 'interview' ? '至少 3/5 人独立描述同类问题，并有明确当前代价。' : '至少 3/5 个目标用户完成关键任务，并主动要求继续使用或接受下一步。',
    failureThreshold: '多数用户没有近期行为、问题代价很低，或现有替代方案已经足够好。',
    duration: method === 'interview' ? '2–3 天' : '3–7 天',
    decisionRule: '达到成功阈值则扩大样本或测试付费；未达到则调整人群/场景/问题定义，不直接扩大开发范围。',
    guardrails: ['不把礼貌性正反馈当作需求证据。', '不收集超出验证所需的个人敏感信息。', '记录来源、日期和原始行为摘要。'],
  }
}

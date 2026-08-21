import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { buildExperiment, filterSignals, normalizeSignals, signalQuality } from './signals.js'
import { buildInterviewGuide, buildOpportunitySolutionTree, buildSourcePlan, scoreSignalSet } from './discovery.js'
import { renderIdeaReport } from './reports.js'
import { resultEnvelope, resultSchema, jsonValue, renderResult, type ResultLineage } from './output.js'
import { buildIdeaOnboarding } from './onboarding.js'
import { buildOpportunityHandoff } from './handoff.js'
import type { IdeaDiscoveryServiceApi } from './service.js'
import type { DiscoverySourceId, FileSystemLike, IdeaCandidate, IdeaConfig, IdeaSignal, InterviewMethod, SignalFilter, SignalSort, SignalSourceType } from './types.js'
import { scanIdeaVault } from './vault.js'
import { fetchExternalSources, type WebLike } from './web.js'
import type {} from '@deepseek-ai/dsh-web'

function ideaOutput(maxChars: number) {
  return { schema: resultSchema, render: (_args: unknown, value: unknown) => renderResult(value, maxChars) }
}

function wrapResult(value: unknown, options: { lineage?: ResultLineage[]; assumptions?: string[]; nextActions?: string[] } = {}) {
  const warnings = typeof value === 'object' && value !== null && 'warnings' in value && Array.isArray(value.warnings)
    ? value.warnings.filter((warning): warning is string => typeof warning === 'string')
    : []
  return resultEnvelope({
    data: jsonValue(value),
    warnings,
    assumptions: options.assumptions,
    lineage: options.lineage,
    nextActions: options.nextActions,
  })
}

function ensureInsideRoot(fs: FileSystemLike, config: IdeaConfig, path: string, signal?: AbortSignal): Promise<void> {
  return Promise.all([fs.resolve(config.defaultRoot, { signal }), fs.resolve(path, { signal })]).then(([root, target]) => {
    if (!fs.contains(root, target)) throw new Error(`Path is outside configured defaultRoot: ${path}`)
  })
}

function filterFromArgs(args: {
  query?: string
  user?: string
  scene?: string
  sourceType?: SignalSourceType
  minPain?: number
  minRepeat?: number
  since?: string
  sort?: SignalSort
  limit?: number
}): SignalFilter {
  return {
    ...(args.query?.trim() ? { query: args.query.trim() } : {}),
    ...(args.user?.trim() ? { user: args.user.trim() } : {}),
    ...(args.scene?.trim() ? { scene: args.scene.trim() } : {}),
    ...(args.sourceType ? { sourceType: args.sourceType } : {}),
    ...(args.minPain !== undefined ? { minPain: args.minPain } : {}),
    ...(args.minRepeat !== undefined ? { minRepeat: args.minRepeat } : {}),
    ...(args.since?.trim() ? { since: args.since.trim() } : {}),
    sort: args.sort ?? 'verifiable',
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
  }
}

function emitStarted(ctx: Context, kind: string, source?: string): void {
  ctx.emit('idea/analysis-started', { kind, ...(source ? { source } : {}) })
}

function emitCompleted(ctx: Context, kind: string, source: string | undefined, warningCount: number): void {
  ctx.emit('idea/analysis-completed', { kind, ...(source ? { source } : {}), warningCount })
}

function candidateFromJson(value: string): IdeaCandidate {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new Error('candidateJson must be valid JSON returned by idea_candidate_draft or idea_review.')
  }
  const data = typeof parsed === 'object' && parsed !== null && 'data' in parsed ? (parsed as { data: unknown }).data : parsed
  const candidate = Array.isArray(data) ? data[0] : data
  if (typeof candidate !== 'object' || candidate === null || !('id' in candidate) || !('title' in candidate)) {
    throw new Error('candidateJson must contain one idea candidate object.')
  }
  return candidate as IdeaCandidate
}

function reviewFromJson(value: string): import('./types.js').IdeaReviewResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new Error('reviewJson must be valid JSON returned by idea_review.')
  }
  const data = typeof parsed === 'object' && parsed !== null && 'data' in parsed ? (parsed as { data: unknown }).data : parsed
  if (typeof data !== 'object' || data === null || !('opportunityMap' in data) || !('signalImport' in data) || !('candidates' in data)) {
    throw new Error('reviewJson must contain an idea_review result.')
  }
  return data as import('./types.js').IdeaReviewResult
}

function signalRecordsFromJson(value: string): { signals: IdeaSignal[]; warnings: string[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new Error('signalsJson must be valid JSON returned by idea_signal_import, idea_signal_filter or another source.')
  }
  const unwrapped = typeof parsed === 'object' && parsed !== null && 'data' in parsed ? (parsed as { data: unknown }).data : parsed
  const candidate = Array.isArray(unwrapped)
    ? unwrapped
    : typeof unwrapped === 'object' && unwrapped !== null && 'signals' in unwrapped
      ? (unwrapped as { signals: unknown }).signals
      : undefined
  if (!Array.isArray(candidate)) throw new Error('signalsJson must contain an array of signals or a result object with a signals array.')
  const records = candidate.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
  const normalized = normalizeSignals(records, 'signalsJson')
  return {
    signals: normalized.signals,
    warnings: normalized.skipped > 0 ? [`Skipped ${normalized.skipped} records without a problem/title.`] : [],
  }
}

function discoverySourceIds(values?: string[]): DiscoverySourceId[] | undefined {
  const supported = new Set<DiscoverySourceId>(['product-hunt', 'trustmrr', 'reddit', 'g2', 'github', 'google-trends', 'app-reviews', 'job-boards', 'policy'])
  const ids = values?.filter((value): value is DiscoverySourceId => supported.has(value as DiscoverySourceId))
  return ids && ids.length > 0 ? [...new Set(ids)] : undefined
}

function isInterviewMethod(value: string): value is InterviewMethod {
  return value === 'jtbd' || value === 'mom-test' || value === 'switching' || value === 'critical-event'
}

export function registerIdeaTools(ctx: Context, config: IdeaConfig, service: IdeaDiscoveryServiceApi, fs: FileSystemLike, web: WebLike): void {
  ctx.tools.register(defineTool({
    name: 'idea_external_scan',
    description: 'Scan user-selected public HTTP(S) pages for external opportunity and unmet-need signals. Uses anonymous public fetch only, returns bounded source snapshots and evidence limits, and does not claim demand from page popularity.',
    parameters: {
      urls: { type: 'array', required: true, items: { type: 'string' }, description: 'One to five public HTTP(S) URLs: community threads, reviews, issue pages, trend pages, competitor pages or research reports.' },
      sourceType: { type: 'string', enum: ['interview', 'support', 'community', 'review', 'issue', 'search', 'competitor', 'survey', 'other'], description: 'Optional source classification applied to all supplied URLs.' },
      focus: { type: 'string', description: 'Optional research focus, such as a target user, scene or job. It is returned as a synthesis instruction; it does not alter page content.' },
    },
    output: ideaOutput(config.maxResultChars),
    async execute(args, exec) {
      emitStarted(ctx, 'external-scan')
      const fetched = await fetchExternalSources(web, args.urls, config, args.sourceType, exec.signal)
      const result = {
        externalFirst: true,
        focus: args.focus?.trim() || undefined,
        sources: fetched.sources,
        warnings: fetched.warnings,
        synthesisInstructions: [
          '从每个来源提取具体用户、触发场景、行为、当前 workaround 和代价。',
          '按用户 × 场景聚类为机会主题，不要把页面标题或抱怨直接写成需求结论。',
          '对每个机会标注来源 URL、抓取时间、证据强度和仍需验证的假设。',
          ...(args.focus?.trim() ? [`优先围绕研究焦点“${args.focus.trim()}”筛选相关信号。`] : []),
        ],
        nextActions: fetched.sources.length > 0
          ? ['根据 source snapshots 提炼外部 signal cards，再运行 idea_candidate_draft 或 idea_experiment_plan。']
          : ['检查 URL 是否公开可访问，或将外部页面导出为 Markdown/CSV/JSON 后运行 idea_signal_import。'],
      }
      emitCompleted(ctx, 'external-scan', undefined, result.warnings.length)
      return wrapResult(result, { lineage: fetched.sources.map((source) => ({ source: source.finalUrl ?? source.url })), nextActions: result.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'idea_source_plan',
    description: 'Create an external-first research plan for a topic. Recommends where to look, what to search, what evidence to inspect and which platform biases to keep visible. Does not claim that a source proves demand.',
    parameters: {
      topic: { type: 'string', required: true, description: 'Opportunity topic, market change or user problem to investigate.' },
      targetUser: { type: 'string', description: 'Optional target role or segment.' },
      market: { type: 'string', description: 'Optional industry or market category.' },
      region: { type: 'string', description: 'Optional country, region or language boundary.' },
      goal: { type: 'string', description: 'Optional research goal, such as finding a paid niche or understanding unmet needs.' },
      sourceIds: { type: 'array', items: { type: 'string' }, description: 'Optional source ids: product-hunt, trustmrr, reddit, g2, github, google-trends, app-reviews, job-boards, policy.' },
    },
    output: ideaOutput(config.maxResultChars),
    async execute(args) {
      const plan = buildSourcePlan({
        topic: args.topic,
        targetUser: args.targetUser,
        market: args.market,
        region: args.region,
        goal: args.goal,
        sourceIds: discoverySourceIds(args.sourceIds),
      })
      return wrapResult(plan, { nextActions: ['按 source plan 选择至少两个来源类型，再运行 idea_opportunity_radar 或 idea_external_scan。'] })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'idea_opportunity_radar',
    description: 'Build an external opportunity radar: recommend public sources and search recipes, optionally fetch user-provided public URLs, and return the evidence gate for turning market signals into opportunity themes. It never performs unrestricted crawling or treats popularity as demand.',
    parameters: {
      topic: { type: 'string', required: true, description: 'Opportunity topic, market change or user problem to investigate.' },
      targetUser: { type: 'string', description: 'Optional target role or segment.' },
      market: { type: 'string', description: 'Optional industry or market category.' },
      region: { type: 'string', description: 'Optional country, region or language boundary.' },
      goal: { type: 'string', description: 'Optional research goal.' },
      sourceIds: { type: 'array', items: { type: 'string' }, description: 'Optional source ids from idea_source_plan.' },
      urls: { type: 'array', items: { type: 'string' }, description: 'Optional user-selected public HTTP(S) pages to snapshot; limited by maxExternalUrls.' },
    },
    output: ideaOutput(config.maxResultChars),
    async execute(args, exec) {
      emitStarted(ctx, 'opportunity-radar')
      const plan = buildSourcePlan({
        topic: args.topic,
        targetUser: args.targetUser,
        market: args.market,
        region: args.region,
        goal: args.goal,
        sourceIds: discoverySourceIds(args.sourceIds),
      })
      const fetched = args.urls?.length
        ? await fetchExternalSources(web, args.urls, config, undefined, exec.signal)
        : { sources: [], warnings: [] }
      const result = {
        externalFirst: true,
        request: { topic: args.topic, targetUser: args.targetUser, market: args.market, region: args.region, goal: args.goal },
        sourcePlan: plan.sources,
        researchSequence: plan.researchSequence,
        evidenceGate: plan.evidenceGate,
        snapshots: fetched.sources,
        warnings: [...plan.warnings, ...fetched.warnings],
        synthesisContract: [
          '先提取用户、触发场景、具体行为、当前 workaround、代价和为什么是现在。',
          '按用户 × 场景 × Job 聚类，不要把一个产品发布或一条抱怨直接写成需求结论。',
          '至少比较两个不同来源类型；分别标记事实、信号、推断和假设。',
          '对候选机会运行 idea_evidence_score，并为最高风险假设设计 48 小时或 7 天实验。',
        ],
        nextActions: fetched.sources.length > 0
          ? ['把 snapshots 提炼成 signal cards，运行 idea_evidence_score，再运行 idea_opportunity_map 或 idea_review。']
          : ['按 sourcePlan 打开并选择公开页面，再把 URL 交给 idea_external_scan 或本工具。'],
      }
      emitCompleted(ctx, 'opportunity-radar', undefined, result.warnings.length)
      return wrapResult(result, {
        lineage: fetched.sources.map((source) => ({ source: source.finalUrl ?? source.url })),
        nextActions: result.nextActions,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'idea_onboarding',
    description: 'Run a read-only idea-discovery readiness check on the configured local workspace. Finds supported signal files, evidence quality gaps and the next discovery step.',
    parameters: {
      root: { type: 'string', description: 'Optional directory under defaultRoot.' },
    },
    output: ideaOutput(config.maxResultChars),
    async execute(args, exec) {
      const root = args.root?.trim() || config.defaultRoot
      await ensureInsideRoot(fs, config, root, exec.signal)
      emitStarted(ctx, 'onboarding', root)
      const scan = await scanIdeaVault(fs, root, config, exec.signal)
      const signals: IdeaSignal[] = []
      const warnings = [...scan.errors]
      for (const file of scan.files.filter((item) => item.status === 'supported')) {
        try {
          await ensureInsideRoot(fs, config, file.path, exec.signal)
          const imported = await service.importSignals(file.path, exec.signal)
          signals.push(...imported.signals)
          warnings.push(...imported.warnings)
        } catch (error) {
          warnings.push(`Skipped ${file.path}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      const result = buildIdeaOnboarding({ root, scan, signals, signalWarnings: warnings })
      emitCompleted(ctx, 'onboarding', root, result.warnings.length)
      return wrapResult(result, { lineage: [{ source: root }], nextActions: result.topActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'idea_signal_import',
    description: 'Import a local Markdown, CSV, TSV, JSON or JSONL file as normalized pain-point signals. Reads only and preserves source lineage.',
    parameters: {
      path: { type: 'string', required: true, description: 'Signal file under defaultRoot.' },
      limit: { type: 'integer', description: 'Optional maximum number of normalized signals to return; defaults to 100.' },
    },
    output: ideaOutput(config.maxResultChars),
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      emitStarted(ctx, 'signal-import', args.path)
      const imported = await service.importSignals(args.path, exec.signal)
      const limit = Math.max(1, Math.min(500, args.limit ?? 100))
      const result = { ...imported, signals: imported.signals.slice(0, limit) }
      emitCompleted(ctx, 'signal-import', args.path, result.warnings.length)
      return wrapResult(result, { lineage: [{ source: args.path }], nextActions: ['运行 idea_signal_filter，先按目标用户、场景和证据强度缩小范围。'] })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'idea_evidence_score',
    description: 'Score a set of idea signals for evidence quality and demand stage. Surfaces missing behavior, workaround, cost, repeat, cross-source and commercial evidence; it is a prioritization aid, not proof of product-market fit.',
    parameters: {
      signalsJson: { type: 'string', required: true, description: 'JSON array of signal records or a result object containing a signals array.' },
    },
    output: ideaOutput(config.maxResultChars),
    async execute(args) {
      const parsed = signalRecordsFromJson(args.signalsJson)
      const scored = scoreSignalSet(parsed.signals)
      return wrapResult({
        externalFirst: true,
        source: 'signalsJson',
        signals: parsed.signals,
        scores: scored.scores,
        summary: scored.summary,
        warnings: [...parsed.warnings, ...scored.warnings],
        nextActions: scored.summary.count > 0
          ? ['优先补齐分数最低但问题代价高的 signal。', '对跨来源复核且有行为/workaround 的机会运行 idea_opportunity_map。', '对有支付、迁移或承诺信号的方向设计最小商业验证。']
          : ['先从 Product Hunt、TrustMRR、Reddit、G2、GitHub 或用户访谈中提炼 signal cards。'],
      }, { nextActions: ['根据证据缺口补充来源或访谈，不要直接把高分改写成市场结论。'] })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'idea_interview_guide',
    description: 'Generate an evidence-first user-need interview guide using JTBD, The Mom Test, switching interviews or critical-event interviews. Focuses on recent behavior, workarounds, costs and triggers rather than feature opinions.',
    parameters: {
      method: { type: 'string', enum: ['jtbd', 'mom-test', 'switching', 'critical-event'], required: true },
      targetUser: { type: 'string', required: true, description: 'Target role or segment.' },
      job: { type: 'string', description: 'Optional Job to Be Done or desired progress.' },
      scene: { type: 'string', description: 'Optional trigger scene.' },
      knownSignal: { type: 'string', description: 'Optional external signal to probe with a recent concrete example.' },
    },
    output: ideaOutput(config.maxResultChars),
    async execute(args) {
      if (!isInterviewMethod(args.method)) throw new Error(`Unsupported interview method: ${args.method}`)
      const guide = buildInterviewGuide({ method: args.method, targetUser: args.targetUser, job: args.job, scene: args.scene, knownSignal: args.knownSignal })
      return wrapResult({ externalFirst: true, guide, nextActions: guide.nextActions }, { nextActions: guide.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'idea_signal_filter',
    description: 'Filter and rank normalized idea signals by keyword, target user, scene, source type, time, pain and repetition. Treats ranking as research prioritization, not demand proof.',
    parameters: {
      path: { type: 'string', required: true, description: 'Signal file under defaultRoot.' },
      query: { type: 'string', description: 'Keyword matched across problem, user, scene, source, quote, workaround and tags.' },
      user: { type: 'string', description: 'Target-user filter.' },
      scene: { type: 'string', description: 'Pain-scenario filter.' },
      sourceType: { type: 'string', enum: ['interview', 'support', 'community', 'review', 'issue', 'search', 'competitor', 'survey', 'other'] },
      minPain: { type: 'number', description: 'Minimum pain score from 1 to 10.' },
      minRepeat: { type: 'number', description: 'Minimum repeat/mention count.' },
      since: { type: 'string', description: 'Only include signals on or after this ISO-like date.' },
      sort: { type: 'string', enum: ['latest', 'repeat', 'pain', 'verifiable'], description: 'Ranking mode; defaults to verifiable.' },
      limit: { type: 'integer', description: 'Maximum result count; defaults to 100.' },
    },
    output: ideaOutput(config.maxResultChars),
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      const filter = filterFromArgs(args)
      emitStarted(ctx, 'signal-filter', args.path)
      const selected = await service.filterSignals(args.path, filter, exec.signal)
      const result = {
        source: selected.source,
        filter,
        count: selected.signals.length,
        signals: selected.signals.map((signal) => ({ ...signal, quality: signalQuality(signal) })),
        warnings: selected.warnings,
        nextActions: ['对重复出现且可追溯的 signal 做机会聚类；不要把单条抱怨直接变成功能。'],
      }
      emitCompleted(ctx, 'signal-filter', args.path, result.warnings.length)
      return wrapResult(result, { lineage: [{ source: args.path }], nextActions: result.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'idea_opportunity_map',
    description: 'Cluster filtered signals by target user and pain scene into opportunity themes. Keeps representative problems, workarounds, evidence scores and risks visible.',
    parameters: {
      path: { type: 'string', required: true, description: 'Signal file under defaultRoot.' },
      query: { type: 'string' },
      user: { type: 'string' },
      scene: { type: 'string' },
      sourceType: { type: 'string', enum: ['interview', 'support', 'community', 'review', 'issue', 'search', 'competitor', 'survey', 'other'] },
      minPain: { type: 'number' },
      minRepeat: { type: 'number' },
      since: { type: 'string' },
      sort: { type: 'string', enum: ['latest', 'repeat', 'pain', 'verifiable'] },
      limit: { type: 'integer' },
    },
    output: ideaOutput(config.maxResultChars),
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      const filter = filterFromArgs(args)
      emitStarted(ctx, 'opportunity-map', args.path)
      const selected = await service.filterSignals(args.path, filter, exec.signal)
      const map = (await service.buildMap(args.path, filter, exec.signal))
      const result = { ...map, filter, importedWarnings: selected.warnings }
      emitCompleted(ctx, 'opportunity-map', args.path, [...map.warnings, ...selected.warnings].length)
      return wrapResult(result, { lineage: [{ source: args.path }], nextActions: map.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'idea_candidate_draft',
    description: 'Draft multiple solution directions from opportunity themes. It is a hypothesis generator, not a proof of product-market fit.',
    parameters: {
      path: { type: 'string', required: true, description: 'Signal file under defaultRoot.' },
      query: { type: 'string' },
      user: { type: 'string' },
      scene: { type: 'string' },
      sourceType: { type: 'string', enum: ['interview', 'support', 'community', 'review', 'issue', 'search', 'competitor', 'survey', 'other'] },
      minPain: { type: 'number' },
      minRepeat: { type: 'number' },
      since: { type: 'string' },
      sort: { type: 'string', enum: ['latest', 'repeat', 'pain', 'verifiable'] },
      limit: { type: 'integer' },
      maxPerTheme: { type: 'integer', description: 'Number of solution lenses per theme; defaults to 2.' },
    },
    output: ideaOutput(config.maxResultChars),
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      const filter = filterFromArgs(args)
      emitStarted(ctx, 'candidate-draft', args.path)
      const result = await service.generateCandidates(args.path, filter, args.maxPerTheme ?? 2, exec.signal)
      emitCompleted(ctx, 'candidate-draft', args.path, result.warnings.length)
      return wrapResult({ ...result, filter, nextActions: ['为一个候选 idea 运行 idea_experiment_plan，并先测最危险假设。'] }, { lineage: [{ source: args.path }] })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'idea_experiment_plan',
    description: 'Create a small validation experiment for one candidate idea. Selects an evidence-first method and explicit success/failure thresholds.',
    parameters: {
      candidateJson: { type: 'string', required: true, description: 'One candidate object or an idea_review/idea_candidate_draft result JSON.' },
    },
    output: ideaOutput(config.maxResultChars),
    async execute(args) {
      const candidate = candidateFromJson(args.candidateJson)
      const experiment = buildExperiment(candidate)
      return wrapResult({ candidate, experiment, nextActions: ['执行实验并记录原始行为、来源、日期、成功/失败阈值和决策。'] })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'idea_review',
    description: 'Run the complete local idea-discovery review: import signals, apply a saved-style filter, cluster opportunities, draft candidates and produce one next experiment.',
    parameters: {
      path: { type: 'string', required: true, description: 'Signal file under defaultRoot.' },
      query: { type: 'string' },
      user: { type: 'string' },
      scene: { type: 'string' },
      sourceType: { type: 'string', enum: ['interview', 'support', 'community', 'review', 'issue', 'search', 'competitor', 'survey', 'other'] },
      minPain: { type: 'number' },
      minRepeat: { type: 'number' },
      since: { type: 'string' },
      sort: { type: 'string', enum: ['latest', 'repeat', 'pain', 'verifiable'] },
      limit: { type: 'integer' },
      maxPerTheme: { type: 'integer' },
    },
    output: ideaOutput(config.maxResultChars),
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      const filter = filterFromArgs(args)
      emitStarted(ctx, 'review', args.path)
      const imported = await service.importSignals(args.path, exec.signal)
      const selected = filterSignals(imported.signals, filter)
      const map = await service.buildMap(args.path, filter, exec.signal)
      const candidates = (await service.generateCandidates(args.path, filter, args.maxPerTheme ?? 2, exec.signal)).candidates
      const recommendedCandidate = candidates[0]
      const quality = {
        strongSignals: selected.filter((signal) => signal.evidenceStrength === 'strong').length,
        mediumSignals: selected.filter((signal) => signal.evidenceStrength === 'medium').length,
        weakSignals: selected.filter((signal) => signal.evidenceStrength === 'weak').length,
        evidenceGaps: [...new Set(selected.flatMap((signal) => signalQuality(signal).missing))],
      }
      const result = {
        generatedAt: new Date().toISOString(),
        source: args.path,
        filter,
        signalImport: { ...imported, signals: selected },
        quality,
        opportunityMap: map,
        candidates,
        recommendedCandidate,
        experiment: recommendedCandidate ? buildExperiment(recommendedCandidate) : undefined,
        warnings: [...imported.warnings, ...map.warnings],
        nextActions: recommendedCandidate
          ? ['先执行推荐候选的最小实验，再决定继续、调整或暂停。']
          : ['补充可用 signal 后重新运行 review。'],
      }
      emitCompleted(ctx, 'review', args.path, result.warnings.length)
      return wrapResult(result, { lineage: [{ source: args.path }], nextActions: result.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'idea_opportunity_handoff',
    description: 'Turn an idea_review result into a versioned opportunity handoff for dsh-product. Preserves the source, evidence, workarounds, riskiest assumption and validation experiment; it does not create a product requirement or claim demand validation.',
    parameters: {
      reviewJson: { type: 'string', required: true, description: 'JSON returned by idea_review.' },
    },
    output: ideaOutput(config.maxResultChars),
    async execute(args) {
      const review = reviewFromJson(args.reviewJson)
      const handoff = buildOpportunityHandoff(review)
      return wrapResult(handoff, { lineage: [{ source: review.source }], nextActions: handoff.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'idea_ost',
    description: 'Turn an idea_review result into an Opportunity Solution Tree: outcome -> opportunity -> multiple candidate solutions -> riskiest assumption -> experiment. Keeps solutions separate from unmet needs.',
    parameters: {
      reviewJson: { type: 'string', required: true, description: 'JSON returned by idea_review.' },
      goal: { type: 'string', description: 'Optional external opportunity goal or target outcome.' },
    },
    output: ideaOutput(config.maxResultChars),
    async execute(args) {
      const review = reviewFromJson(args.reviewJson)
      const tree = buildOpportunitySolutionTree(review, args.goal)
      return wrapResult({ externalFirst: true, tree, nextActions: tree.nextActions }, { lineage: [{ source: review.source }], nextActions: tree.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'idea_report',
    description: 'Render an idea_review result as a shareable Markdown report. Reads the supplied JSON only and does not write files.',
    parameters: {
      reviewJson: { type: 'string', required: true, description: 'JSON returned by idea_review.' },
    },
    output: ideaOutput(config.maxResultChars),
    async execute(args) {
      const review = reviewFromJson(args.reviewJson)
      return wrapResult({
        source: review.source,
        reportMarkdown: renderIdeaReport(review),
        nextActions: review.nextActions,
      }, { lineage: [{ source: review.source }], nextActions: review.nextActions })
    },
  }))
}

import type { IdeaOnboardingResult, IdeaSignal } from './types.js'
import type { IdeaVaultScan } from './vault.js'

export function buildIdeaOnboarding(options: {
  root: string
  scan: IdeaVaultScan
  signals: IdeaSignal[]
  signalWarnings: string[]
}): IdeaOnboardingResult {
  const { root, scan, signals, signalWarnings } = options
  const supportedFiles = scan.files.filter((file) => file.status === 'supported')
  const signalFiles = supportedFiles.filter((file) => /signal|pain|idea|opportunity|需求|痛点|创意/i.test(file.path)).length
  const sourceTypes = [...new Set(signals.map((signal) => signal.sourceType))]
  const strong = signals.filter((signal) => signal.evidenceStrength === 'strong').length
  const qualityScore = signals.length > 0 ? Math.round((strong / signals.length) * 100) : 0
  const dimensions: IdeaOnboardingResult['dimensions'] = [
    {
      id: 'context',
      label: '发现边界',
      status: signals.some((signal) => signal.user || signal.scene) ? 'ready' : 'partial',
      score: signals.length > 0 && signals.some((signal) => signal.user || signal.scene) ? 80 : 30,
      evidence: signals.some((signal) => signal.user || signal.scene) ? ['Signals contain target-user or scene fields.'] : [],
      missing: signals.some((signal) => signal.user || signal.scene) ? [] : ['补充目标用户、场景或主题。'],
      nextAction: '明确目标用户、触发场景、时间范围和约束。',
    },
    {
      id: 'signals',
      label: '问题信号',
      status: signals.length > 0 ? 'ready' : 'missing',
      score: signals.length > 0 ? Math.min(100, 40 + signals.length * 5) : 0,
      evidence: signals.length > 0 ? [`读取到 ${signals.length} 条可用 signal。`, `来源类型：${sourceTypes.join(', ') || '未标注'}`] : [],
      missing: signals.length > 0 ? [] : ['导入访谈、客服、社区、评论或研究记录。'],
      nextAction: '先收集具体行为和当前替代方案，不要先写功能列表。',
    },
    {
      id: 'evidence',
      label: '证据质量',
      status: signals.length === 0 ? 'missing' : qualityScore >= 60 ? 'ready' : 'partial',
      score: signals.length === 0 ? 0 : qualityScore,
      evidence: strong > 0 ? [`${strong} 条 signal 具备较强可追溯证据。`] : [],
      missing: signals.length === 0 ? ['没有 signal 可评估。'] : qualityScore >= 60 ? [] : ['补充来源、原话、具体行为、workaround 或代价。'],
      nextAction: '给每条 signal 补来源、日期、行为、代价和重复出现情况。',
    },
    {
      id: 'opportunity',
      label: '机会综合',
      status: signals.length >= 3 ? 'ready' : signals.length > 0 ? 'partial' : 'missing',
      score: signals.length >= 3 ? 80 : signals.length > 0 ? 40 : 0,
      evidence: signals.length >= 3 ? ['有足够 signal 开始按用户和场景聚类。'] : [],
      missing: signals.length >= 3 ? [] : ['至少准备 3 条可比较的 signal，再形成机会主题。'],
      nextAction: '运行机会映射，区分问题主题、候选解法和验证实验。',
    },
    {
      id: 'validation',
      label: '验证准备',
      status: 'partial',
      score: 35,
      evidence: [],
      missing: ['尚未记录最危险假设、成功阈值和失败阈值。'],
      nextAction: '为证据最强的机会生成 48 小时或 7 天实验。',
    },
  ]
  const overallScore = Math.round(dimensions.reduce((sum, dimension) => sum + (dimension.score ?? 0), 0) / dimensions.length)
  const overallStatus = signals.length === 0 ? 'blocked' : overallScore >= 70 ? 'ready' : 'partial'
  const steps: IdeaOnboardingResult['sop']['steps'] = [
    { id: 'context', order: 1, status: dimensions[0]?.status ?? 'missing', objective: '明确目标用户、场景、主题和约束。', tool: 'idea_onboarding', prompt: '定义我要研究谁、在什么场景下遇到什么问题。' },
    { id: 'signals', order: 2, status: dimensions[1]?.status ?? 'missing', objective: '收集和规范化真实问题信号。', tool: 'idea_signal_import / idea_signal_filter', prompt: '导入并筛选访谈、社区、客服或评论信号。' },
    { id: 'synthesis', order: 3, status: dimensions[3]?.status ?? 'missing', objective: '将相似信号聚成机会主题。', tool: 'idea_opportunity_map', prompt: '按用户和场景形成机会解法树的上半部分。' },
    { id: 'validation', order: 4, status: dimensions[4]?.status ?? 'partial', objective: '找出最危险假设并设计最小实验。', tool: 'idea_experiment_plan', prompt: '为优先机会生成一个不依赖完整开发的实验。' },
    { id: 'review', order: 5, status: overallStatus === 'ready' ? 'ready' : 'partial', objective: '回顾证据、决策和下一步。', tool: 'idea_review', prompt: '输出证据、机会、候选 idea 和继续/调整/暂停决策。' },
  ]
  const currentStep = steps.find((step) => step.status === 'missing' || step.status === 'partial')?.id ?? 'review'
  return {
    generatedAt: new Date().toISOString(),
    root,
    overallStatus,
    overallScore,
    sources: { files: supportedFiles.length, signalFiles, signals: signals.length, sourceTypes },
    dimensions,
    sop: { currentStep, steps },
    topActions: signals.length === 0
      ? ['导入一份包含 problem/pain/痛点 字段的 Markdown、CSV、JSON 或 JSONL 文件。', '补充目标用户、场景和来源链接。']
      : ['先运行 idea_opportunity_map，观察重复的用户/场景主题。', '为证据最强的主题运行 idea_experiment_plan。'],
    questions: signals.length === 0
      ? ['你要研究哪类用户？', '他们在什么具体场景中遇到问题？', '目前用什么 workaround？']
      : ['哪些 signal 来自最近的真实行为？', '哪个机会主题最容易在 7 天内验证？'],
    warnings: [...scan.errors, ...signalWarnings, ...(scan.skippedFiles > 0 ? [`Skipped ${scan.skippedFiles} unsupported files.`] : [])],
  }
}

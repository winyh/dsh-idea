import type { ExperimentPlan, IdeaCandidate, IdeaReviewResult, OpportunityTheme } from './types.js'

export interface OpportunityHandoff {
  handoffVersion: '1.0'
  artifactType: 'opportunity-handoff'
  handoffFrom: 'dsh-idea'
  handoffTo: 'dsh-product'
  generatedAt: string
  status: 'ready' | 'partial'
  source: string
  candidateId?: string
  title: string
  targetUser: string
  scene: string
  job: string
  problem: string
  currentWorkarounds: string[]
  evidence: string[]
  whyNow: string
  solutionDirections: string[]
  riskiestAssumption: string
  validationExperiment?: ExperimentPlan
  warnings: string[]
  nextActions: string[]
  markdown: string
}

function listOrFallback(values: string[], fallback: string): string[] {
  return values.length > 0 ? values : [fallback]
}

function themeForCandidate(review: IdeaReviewResult, candidate?: IdeaCandidate): OpportunityTheme | undefined {
  return review.opportunityMap.themes.find((theme) => theme.id === candidate?.themeId) ?? review.opportunityMap.themes[0]
}

function yaml(value: string): string {
  return JSON.stringify(value)
}

function markdownList(values: string[], fallback = '待补充'): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : `- ${fallback}`
}

export function buildOpportunityHandoff(review: IdeaReviewResult): OpportunityHandoff {
  const candidate = review.recommendedCandidate ?? review.candidates[0]
  const theme = themeForCandidate(review, candidate)
  const title = candidate?.title || theme?.title || '待命名机会'
  const targetUser = candidate?.user || theme?.user || ''
  const scene = candidate?.scene || theme?.scene || ''
  const job = theme?.opportunity || candidate?.problem || ''
  const problem = candidate?.problem || theme?.representativeProblems[0] || ''
  const currentWorkarounds = listOrFallback(theme?.currentWorkarounds ?? [], '待补充当前替代方案')
  const evidence = candidate?.evidence ?? []
  const solutionDirections = review.candidates.slice(0, 5).map((item) => `${item.title}：${item.solution}`)
  const whyNow = candidate?.whyNow || '待补充触发变化、时间窗口或外部信号。'
  const riskiestAssumption = candidate?.riskiestAssumption || '待补充最危险假设。'
  const warnings = [...review.warnings]
  if (!candidate) warnings.push('没有候选方向；当前交接只能作为机会主题草案。')
  if (evidence.length === 0) warnings.push('候选方向缺少证据；不得把本交接当作已验证需求。')
  if (!review.experiment) warnings.push('没有最小验证实验；交给产品前仍缺少验证路径。')
  const status: OpportunityHandoff['status'] = candidate && evidence.length > 0 && Boolean(review.experiment) ? 'ready' : 'partial'
  const nextActions = status === 'ready'
    ? ['交给 dsh-product 生成产品 Brief；不要在产品阶段重新做外部需求发现。', '把验证实验的成功/失败阈值和原始证据写回机会记录。']
    : ['补齐候选方向、来源证据和最小验证实验，再交给 dsh-product。']
  const generatedAt = new Date().toISOString()
  const handoff: OpportunityHandoff = {
    handoffVersion: '1.0',
    artifactType: 'opportunity-handoff',
    handoffFrom: 'dsh-idea',
    handoffTo: 'dsh-product',
    generatedAt,
    status,
    source: review.source,
    ...(candidate ? { candidateId: candidate.id } : {}),
    title,
    targetUser,
    scene,
    job,
    problem,
    currentWorkarounds,
    evidence,
    whyNow,
    solutionDirections,
    riskiestAssumption,
    ...(review.experiment ? { validationExperiment: review.experiment } : {}),
    warnings,
    nextActions,
    markdown: '',
  }
  handoff.markdown = [
    '---',
    `handoffVersion: ${handoff.handoffVersion}`,
    `artifactType: ${handoff.artifactType}`,
    `handoffFrom: ${handoff.handoffFrom}`,
    `handoffTo: ${handoff.handoffTo}`,
    `status: ${handoff.status}`,
    `generatedAt: ${generatedAt}`,
    `source: ${yaml(handoff.source)}`,
    `candidateId: ${yaml(handoff.candidateId ?? '')}`,
    '---',
    `# ${title}`,
    '',
    '## 机会定义',
    `- 目标用户：${targetUser || '待补充'}`,
    `- 触发场景：${scene || '待补充'}`,
    `- 要完成的 Job：${job || '待补充'}`,
    `- 代表性问题：${problem || '待补充'}`,
    `- 为什么是现在：${whyNow}`,
    '',
    '## 当前替代方案',
    markdownList(currentWorkarounds),
    '',
    '## 证据',
    markdownList(evidence),
    '',
    '## 候选解法方向',
    markdownList(solutionDirections),
    '',
    '## 最危险假设',
    riskiestAssumption,
    '',
    '## 最小验证实验',
    review.experiment ? `- 方法：${review.experiment.method}\n- 目标受众：${review.experiment.audience}\n- 成功阈值：${review.experiment.successThreshold}\n- 失败阈值：${review.experiment.failureThreshold}\n- 决策规则：${review.experiment.decisionRule}` : '- 待补充',
    '',
    '## 交接纪律',
    '- 本材料是机会假设和验证入口，不是产品需求承诺。',
    '- dsh-product 只接收已明确来源、证据边界和下一步验证动作的方向。',
    '',
    '## 风险与下一步',
    markdownList(warnings),
    markdownList(nextActions),
    '',
  ].join('\n')
  return handoff
}

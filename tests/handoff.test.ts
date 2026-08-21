import { describe, expect, it } from 'vitest'
import { buildOpportunityHandoff } from '../src/handoff.js'
import type { IdeaReviewResult } from '../src/types.js'

const review: IdeaReviewResult = {
  generatedAt: '2026-08-21T00:00:00.000Z',
  source: 'signals.json',
  filter: { sort: 'verifiable' },
  signalImport: { source: 'signals.json', signals: [], rowsRead: 2, rowsAccepted: 2, warnings: [] },
  quality: { strongSignals: 2, mediumSignals: 0, weakSignals: 0, evidenceGaps: [] },
  opportunityMap: {
    generatedAt: '2026-08-21T00:00:00.000Z',
    source: 'signals.json',
    signalsConsidered: 2,
    themes: [{ id: 'theme-1', title: '可信选购', user: '新手父母', scene: '购买前', opportunity: '快速完成可信比较', signalCount: 2, totalRepeatCount: 3, averagePainScore: 4, evidenceScore: 80, signalIds: ['s1'], representativeProblems: ['信息分散'], currentWorkarounds: ['手工比较多个页面'], risks: [] }],
    warnings: [],
    nextActions: [],
  },
  candidates: [{ id: 'candidate-1', themeId: 'theme-1', title: '选购助手', user: '新手父母', scene: '购买前', problem: '信息分散', solutionLens: 'copilot', solution: '生成带来源的比较清单', whyNow: '信息渠道增加', evidence: ['3 次重复抱怨'], riskiestAssumption: '用户愿意提供预算和偏好', score: { problem: 4, evidence: 4, reachability: 3, feasibility: 3, testability: 4 }, confidence: 'medium', nextTest: '人工生成清单' }],
  recommendedCandidate: undefined,
  experiment: { candidateId: 'candidate-1', hypothesis: '用户愿意使用带来源的清单', riskiestAssumption: '用户愿意提供预算和偏好', method: 'concierge', audience: '新手父母', steps: ['人工生成清单'], evidenceToCollect: ['是否完成购买'], successThreshold: '3/5 完成', failureThreshold: '0/5 完成', duration: '7 天', decisionRule: '达到成功阈值则继续', guardrails: [] },
  warnings: [],
  nextActions: [],
}

describe('opportunity handoff', () => {
  it('creates a product-ready handoff without losing evidence boundaries', () => {
    const handoff = buildOpportunityHandoff(review)
    expect(handoff.artifactType).toBe('opportunity-handoff')
    expect(handoff.handoffTo).toBe('dsh-product')
    expect(handoff.status).toBe('ready')
    expect(handoff.validationExperiment?.method).toBe('concierge')
    expect(handoff.markdown).toContain('handoffVersion: 1.0')
  })

  it('marks incomplete opportunity evidence as partial', () => {
    const partial = buildOpportunityHandoff({ ...review, candidates: [], recommendedCandidate: undefined, experiment: undefined })
    expect(partial.status).toBe('partial')
    expect(partial.warnings.join(' ')).toContain('没有候选方向')
  })
})

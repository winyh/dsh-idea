import { describe, expect, it } from 'vitest'
import { buildInterviewGuide, buildOpportunitySolutionTree, buildSourcePlan, scoreSignalSet } from '../src/discovery.js'
import { buildOpportunityMap, generateCandidates, normalizeSignals } from '../src/signals.js'
import type { IdeaReviewResult } from '../src/types.js'

describe('external discovery workflow', () => {
  it('creates a source plan with Product Hunt and TrustMRR recipes', () => {
    const plan = buildSourcePlan({
      topic: 'AI 财务管理',
      targetUser: '小企业主',
      market: 'SaaS',
      region: '美国',
      sourceIds: ['product-hunt', 'trustmrr'],
    })
    expect(plan.externalFirst).toBe(true)
    expect(plan.sources.map((source) => source.id)).toEqual(['product-hunt', 'trustmrr'])
    expect(plan.sources[0]?.queryTemplates.join(' ')).toContain('AI 财务管理')
    expect(plan.sources[1]?.bias).toContain('选择偏差')
  })

  it('scores behavior, workaround, cost and cross-source evidence without claiming demand', () => {
    const normalized = normalizeSignals([
      {
        problem: '每月手工核对发票', user: '小企业主', scene: '财务管理', source: 'Reddit', sourceType: 'community',
        sourceUrl: 'https://reddit.com/a', behavior: '复制三个系统的表格', workaround: 'Excel + 外包', cost: '每月 6 小时',
        paymentSignal: '已经支付会计服务费', whyNow: '税务申报临近', repeatCount: 4, painScore: 8,
      },
      {
        problem: '发票对账很麻烦', user: '小企业主', scene: '财务管理', source: 'G2', sourceType: 'review',
        sourceUrl: 'https://g2.com/a', behavior: '人工逐笔检查', workaround: '另一款软件', cost: '容易漏项', repeatCount: 2, painScore: 7,
      },
    ], 'signals.json')
    const scored = scoreSignalSet(normalized.signals)
    expect(scored.summary.crossValidated).toBe(2)
    expect(scored.scores[0]?.demandStage).toBe('commercial-signal')
    expect(scored.scores[0]?.score).toBeGreaterThan(70)
    expect(scored.warnings[0]).toContain('不等于')
  })

  it('generates interview guidance and an opportunity solution tree', () => {
    const guide = buildInterviewGuide({ method: 'mom-test', targetUser: '运营人员', job: '按时交付报告', scene: '周报整理' })
    expect(guide.title).toContain('Mom Test')
    expect(guide.questions.join(' ')).toContain('最近一次')

    const { signals } = normalizeSignals([
      { problem: '手工整理报告', user: '运营人员', scene: '周报整理', source: 'interview', sourceUrl: 'https://example.com/a', behavior: '复制数据', workaround: '表格', cost: '每周 4 小时', repeatCount: 3, painScore: 8 },
    ], 'signals.json')
    const map = buildOpportunityMap(signals, 'signals.json')
    const candidates = generateCandidates(map.themes, 2)
    const review: IdeaReviewResult = {
      generatedAt: new Date().toISOString(),
      source: 'signals.json',
      filter: {},
      signalImport: { source: 'signals.json', signals, warnings: [], rowsRead: 1, rowsAccepted: 1 },
      quality: { strongSignals: 1, mediumSignals: 0, weakSignals: 0, evidenceGaps: [] },
      opportunityMap: map,
      candidates,
      warnings: [],
      nextActions: [],
    }
    const tree = buildOpportunitySolutionTree(review, '验证运营报告自动化机会')
    expect(tree.goal).toBe('验证运营报告自动化机会')
    expect(tree.opportunities[0]?.solutions).toHaveLength(2)
    expect(tree.opportunities[0]?.solutions[0]?.experiment).toBeDefined()
  })
})

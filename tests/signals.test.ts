import { describe, expect, it } from 'vitest'
import { parseCsv, parseRecords } from '../src/data.js'
import { buildExperiment, buildOpportunityMap, filterSignals, generateCandidates, normalizeSignals, signalQuality } from '../src/signals.js'

describe('idea signal pipeline', () => {
  it('parses CSV records with typed values', () => {
    const rows = parseCsv('problem,user,painScore\n"Export breaks, often",运营,8\nToo slow,PM,6')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.problem).toBe('Export breaks, often')
    expect(rows[0]?.painScore).toBe(8)
  })

  it('normalizes, filters and scores signals', () => {
    const normalized = normalizeSignals([
      {
        problem: '每周手工整理报告',
        user: '运营人员',
        scene: '内容运营',
        source: '访谈',
        sourceUrl: 'https://example.com/interview',
        behavior: '复制多个表格再手工合并',
        workaround: 'Excel + 脚本',
        cost: '每周 4 小时',
        painScore: 8,
        repeatCount: 5,
        capturedAt: '2026-08-20',
      },
      { problem: '希望有一个更好的工具', user: '运营人员', scene: '内容运营', source: '社区', painScore: 3 },
    ], 'signals.csv')
    expect(normalized.signals).toHaveLength(2)
    expect(normalized.signals[0]?.evidenceStrength).toBe('strong')
    expect(signalQuality(normalized.signals[0]!).score).toBeGreaterThan(50)
    const selected = filterSignals(normalized.signals, { minPain: 7, sort: 'verifiable' })
    expect(selected).toHaveLength(1)
    expect(selected[0]?.user).toBe('运营人员')
  })

  it('maps opportunities and drafts candidates plus an experiment', () => {
    const { signals } = normalizeSignals([
      { problem: 'A', user: 'PM', scene: '交付协作', source: 'interview', repeatCount: 3, painScore: 7, behavior: '手工同步', sourceUrl: 'https://example.com/a' },
      { problem: 'B', user: 'PM', scene: '交付协作', source: 'community', repeatCount: 2, painScore: 8, workaround: '群聊', sourceUrl: 'https://example.com/b' },
    ], 'signals.json')
    const map = buildOpportunityMap(signals, 'signals.json')
    expect(map.themes).toHaveLength(1)
    expect(map.themes[0]?.signalCount).toBe(2)
    const candidates = generateCandidates(map.themes, 2)
    expect(candidates).toHaveLength(2)
    const experiment = buildExperiment(candidates[0]!)
    expect(experiment.candidateId).toBe(candidates[0]?.id)
    expect(experiment.successThreshold).toContain('3/5')
  })

  it('returns a warning for JSON that is not an array of records', () => {
    const parsed = parseRecords('signals.json', '"not a record"')
    expect(parsed.records).toEqual([])
    expect(parsed.warnings).toHaveLength(0)
  })
})

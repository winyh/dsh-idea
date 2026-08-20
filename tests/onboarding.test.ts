import { describe, expect, it } from 'vitest'
import { buildIdeaOnboarding } from '../src/onboarding.js'
import type { IdeaSignal } from '../src/types.js'
import type { IdeaVaultScan } from '../src/vault.js'

const signal: IdeaSignal = {
  id: 'signal-1',
  title: '手工报告',
  problem: '每周手工整理报告',
  user: '运营人员',
  scene: '内容运营',
  source: 'interview',
  sourceType: 'interview',
  sourceUrl: 'https://example.com',
  behavior: '复制表格',
  workaround: 'Excel',
  cost: '4 hours',
  painScore: 8,
  repeatCount: 4,
  tags: ['report'],
  evidenceStrength: 'strong',
  evidenceState: 'signal',
}

const scan: IdeaVaultScan = {
  root: '.',
  files: [{ path: 'signals.csv', extension: '.csv', size: 100, status: 'supported' }],
  skippedFiles: 0,
  errors: [],
}

describe('idea onboarding', () => {
  it('reports a partial but actionable workspace', () => {
    const result = buildIdeaOnboarding({ root: '.', scan, signals: [signal], signalWarnings: [] })
    expect(result.overallStatus).toBe('partial')
    expect(result.sources.signals).toBe(1)
    expect(result.sop.currentStep).toBe('synthesis')
    expect(result.topActions.length).toBe(2)
  })

  it('blocks when no signal is available', () => {
    const result = buildIdeaOnboarding({ root: '.', scan: { ...scan, files: [] }, signals: [], signalWarnings: [] })
    expect(result.overallStatus).toBe('blocked')
    expect(result.overallScore).toBe(13)
    expect(result.sop.currentStep).toBe('context')
    expect(result.questions.length).toBeGreaterThan(0)
  })
})

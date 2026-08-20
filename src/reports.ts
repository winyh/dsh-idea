import type { IdeaReviewResult } from './types.js'

function bullet(value: string): string {
  return `- ${value.replace(/\r?\n/g, ' ')}`
}

export function renderIdeaReport(review: IdeaReviewResult): string {
  const recommended = review.recommendedCandidate
  const lines = [
    '# Idea Discovery Review',
    '',
    `- Generated at: ${review.generatedAt}`,
    `- Source: ${review.source}`,
    `- Signals selected: ${review.signalImport.signals.length}`,
    `- Filter: ${JSON.stringify(review.filter)}`,
    '',
    '## Answer first',
    '',
    recommended ? `先验证：**${recommended.title}**。原因是问题证据 ${recommended.score.evidence}/5，下一步测试成本低，且当前结果仍保留了未验证假设。` : '当前没有足够 signal 形成可推荐的候选 idea。',
    '',
    '## Evidence quality',
    '',
    bullet(`Strong: ${review.quality.strongSignals}`),
    bullet(`Medium: ${review.quality.mediumSignals}`),
    bullet(`Weak: ${review.quality.weakSignals}`),
    ...(review.quality.evidenceGaps.length > 0 ? [bullet(`Gaps: ${review.quality.evidenceGaps.join(', ')}`)] : []),
    '',
    '## Opportunity themes',
    '',
  ]
  for (const theme of review.opportunityMap.themes) {
    lines.push(`### ${theme.title}`)
    lines.push('')
    lines.push(bullet(theme.opportunity))
    lines.push(bullet(`Signals: ${theme.signalCount}; repeated mentions: ${theme.totalRepeatCount}; evidence: ${theme.evidenceScore}/100`))
    for (const problem of theme.representativeProblems) lines.push(bullet(`Problem: ${problem}`))
    for (const risk of theme.risks) lines.push(bullet(`Risk: ${risk}`))
    lines.push('')
  }
  lines.push('## Candidate ideas', '')
  for (const candidate of review.candidates.slice(0, 10)) {
    lines.push(`### ${candidate.title}`)
    lines.push('')
    lines.push(bullet(candidate.solution))
    lines.push(bullet(`Riskiest assumption: ${candidate.riskiestAssumption}`))
    lines.push(bullet(`Next test: ${candidate.nextTest}`))
    lines.push('')
  }
  if (review.experiment) {
    lines.push('## Recommended experiment', '')
    lines.push(bullet(`Method: ${review.experiment.method}`))
    lines.push(bullet(`Audience: ${review.experiment.audience}`))
    lines.push(bullet(`Success threshold: ${review.experiment.successThreshold}`))
    lines.push(bullet(`Failure threshold: ${review.experiment.failureThreshold}`))
    lines.push(bullet(`Decision: ${review.experiment.decisionRule}`))
  }
  if (review.warnings.length > 0) {
    lines.push('', '## Warnings', '')
    for (const warning of review.warnings) lines.push(bullet(warning))
  }
  lines.push('', '## Next actions', '')
  for (const action of review.nextActions) lines.push(bullet(action))
  return `${lines.join('\n')}\n`
}

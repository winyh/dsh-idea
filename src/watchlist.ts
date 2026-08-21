import type { ExternalSourceSnapshot } from './web.js'
import type { IdeaWatchlistDiff } from './types.js'

function changedFields(current: ExternalSourceSnapshot, previous: ExternalSourceSnapshot): string[] {
  const fields = ['title', 'description', 'headings', 'excerpt', 'statusCode', 'finalUrl'] as const
  return fields.filter((field) => JSON.stringify(current[field]) !== JSON.stringify(previous[field]))
}

export function buildWatchlistDiff(current: ExternalSourceSnapshot[], previous: ExternalSourceSnapshot[] = []): IdeaWatchlistDiff {
  const previousByUrl = new Map(previous.map((item) => [item.finalUrl ?? item.url, item]))
  const items = current.map((snapshot) => {
    const key = snapshot.finalUrl ?? snapshot.url
    const old = previousByUrl.get(key) ?? previousByUrl.get(snapshot.url)
    if (!old) return { url: snapshot.url, status: 'new' as const, changedFields: ['snapshot'], currentFetchedAt: snapshot.fetchedAt, title: snapshot.title, excerpt: snapshot.excerpt, ...(snapshot.warnings[0] ? { warning: snapshot.warnings[0] } : {}) }
    const fields = changedFields(snapshot, old)
    return {
      url: snapshot.url,
      status: fields.length > 0 ? 'changed' as const : 'unchanged' as const,
      changedFields: fields,
      currentFetchedAt: snapshot.fetchedAt,
      previousFetchedAt: old.fetchedAt,
      title: snapshot.title,
      excerpt: snapshot.excerpt,
      ...(snapshot.warnings[0] ? { warning: snapshot.warnings[0] } : {}),
    }
  })
  const warnings = current.flatMap((item) => item.warnings)
  const changed = items.filter((item) => item.status === 'new' || item.status === 'changed').length
  const nextActions = changed > 0
    ? ['审阅 changed/new 页面，再把真实变化转成 signal card；不要把页面变化直接当作需求结论。']
    : ['继续保留本次快照，下一周期使用相同 URL 和口径复查。']
  const markdown = [
    '---',
    'artifactType: idea-watchlist-diff',
    `generatedAt: ${new Date().toISOString()}`,
    '---',
    '# 机会来源 Watchlist 变化',
    '',
    ...items.map((item) => `- ${item.status}: ${item.url}${item.changedFields.length > 0 ? `（${item.changedFields.join('、')}）` : ''}`),
    '',
    '## 下一步',
    ...nextActions.map((item) => `- ${item}`),
    '',
  ].join('\n')
  return { artifactType: 'idea-watchlist-diff', generatedAt: new Date().toISOString(), items, warnings, nextActions, markdown }
}

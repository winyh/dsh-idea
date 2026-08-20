import { describe, expect, it } from 'vitest'
import { fetchExternalSources, type WebLike } from '../src/web.js'
import type { IdeaConfig } from '../src/types.js'

const config: IdeaConfig = {
  defaultRoot: '.',
  reportDir: '.dsh-idea/reports',
  maxFiles: 10,
  maxRows: 100,
  maxFileBytes: 100_000,
  maxTextChars: 100_000,
  maxResultChars: 10_000,
  defaultLanguage: 'zh-CN',
  defaultSort: 'verifiable',
  maxExternalUrls: 2,
  maxExternalChars: 200,
  requestTimeoutMs: 10_000,
}

describe('external source scan', () => {
  it('fetches bounded public page snapshots without credentials', async () => {
    const web: WebLike = {
      async fetch(request) {
        expect(request.url).toBe('https://example.com/thread')
        return {
          url: request.url,
          statusCode: 200,
          body: { kind: 'html', content: '<html><title>Need a workflow</title><h1>Operators repeat this task</h1><p>Users copy data between tools.</p></html>' },
        }
      },
    }
    const result = await fetchExternalSources(web, ['https://example.com/thread'], config, 'community')
    expect(result.sources[0]?.title).toBe('Need a workflow')
    expect(result.sources[0]?.headings).toEqual(['Operators repeat this task'])
    expect(result.sources[0]?.excerpt).toContain('Users copy data')
  })

  it('skips invalid URLs and applies the configured URL limit', async () => {
    const web: WebLike = { async fetch() { throw new Error('should not fetch invalid input') } }
    const result = await fetchExternalSources(web, ['not-a-url', 'ftp://example.com', 'https://third.example'], config)
    expect(result.sources).toHaveLength(0)
    expect(result.warnings.length).toBeGreaterThanOrEqual(2)
  })
})

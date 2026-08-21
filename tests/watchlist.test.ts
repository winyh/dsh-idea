import { describe, expect, it } from 'vitest'
import { buildWatchlistDiff } from '../src/watchlist.js'

const base = {
  url: 'https://example.com/page',
  fetchedAt: '2026-08-21T00:00:00.000Z',
  sourceType: 'other' as const,
  title: 'Old title',
  description: 'Description',
  headings: ['A'],
  excerpt: 'Old excerpt',
  truncated: false,
  warnings: [],
}

describe('idea watchlist diff', () => {
  it('reports changed page fields', () => {
    const result = buildWatchlistDiff([{ ...base, title: 'New title' }], [base])
    expect(result.items[0]?.status).toBe('changed')
    expect(result.items[0]?.changedFields).toContain('title')
  })

  it('does not turn a first snapshot into demand proof', () => {
    const result = buildWatchlistDiff([base])
    expect(result.items[0]?.status).toBe('new')
    expect(result.nextActions.join(' ')).toContain('signal card')
  })
})

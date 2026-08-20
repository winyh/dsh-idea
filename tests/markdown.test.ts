import { describe, expect, it } from 'vitest'
import { parseNote, recordsFromNote } from '../src/markdown.js'

describe('idea Markdown inputs', () => {
  it('extracts frontmatter, tables, headings and source links', () => {
    const note = parseNote('signals.md', `---
type: idea-signals
source: https://example.com/source
---

# 用户痛点

| problem | user | scene | painScore |
| --- | --- | --- | --- |
| 交付信息分散 | PM | 交付协作 | 8 |

来源：https://example.com/second`)
    expect(note.title).toBe('用户痛点')
    expect(note.frontmatter.type).toBe('idea-signals')
    expect(note.tables[0]?.rows[0]?.problem).toBe('交付信息分散')
    expect(note.externalLinks).toContain('https://example.com/source')
    expect(recordsFromNote(note)).toHaveLength(1)
  })

  it('uses signal frontmatter when no table is present', () => {
    const note = parseNote('one.md', `---
problem: 审批流程很慢
user: 财务
scene: 合规
---

# Note`)
    expect(recordsFromNote(note)[0]?.problem).toBe('审批流程很慢')
  })
})

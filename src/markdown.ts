import type { Frontmatter, IdeaNote, MarkdownTable } from './types.js'

function scalar(value: string): unknown {
  const trimmed = value.trim()
  if (trimmed === '') return ''
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1)
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    try { return JSON.parse(trimmed) as unknown } catch { return trimmed }
  }
  return trimmed
}

function parseFrontmatter(text: string): { frontmatter: Frontmatter; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: text }
  const frontmatter: Frontmatter = {}
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    frontmatter[key] = scalar(line.slice(separator + 1))
  }
  return { frontmatter, body: match[2] ?? '' }
}

function parseTable(lines: string[], start: number): { table: MarkdownTable; next: number } | undefined {
  const headerLine = lines[start]
  const separatorLine = lines[start + 1]
  if (!headerLine || !separatorLine || !/^\s*\|?\s*:?-{2,}/.test(separatorLine)) return undefined
  const split = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
  const headers = split(headerLine)
  if (headers.length === 0 || headers.some((header) => header === '')) return undefined
  const rows: Array<Record<string, string>> = []
  let index = start + 2
  while (index < lines.length && lines[index]?.includes('|')) {
    const cells = split(lines[index] ?? '')
    if (cells.length > 0) {
      rows.push(Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ''])))
    }
    index += 1
  }
  return { table: { headers, rows }, next: index }
}

function titleFrom(path: string, body: string, frontmatter: Frontmatter): string {
  if (typeof frontmatter.title === 'string' && frontmatter.title.trim()) return frontmatter.title.trim()
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (heading) return heading
  const name = path.replace(/\\/g, '/').split('/').at(-1) ?? path
  return name.replace(/\.[^.]+$/, '')
}

export function parseNote(path: string, text: string): IdeaNote {
  const { frontmatter, body } = parseFrontmatter(text)
  const lines = body.split(/\r?\n/)
  const headings = lines.flatMap((line) => {
    const match = line.match(/^#{1,6}\s+(.+)$/)
    return match?.[1]?.trim() ? [match[1].trim()] : []
  })
  const tables: MarkdownTable[] = []
  for (let index = 0; index < lines.length - 1; index += 1) {
    const parsed = parseTable(lines, index)
    if (!parsed) continue
    tables.push(parsed.table)
    index = parsed.next - 1
  }
  const externalLinks = [...new Set([
    ...(body.match(/https?:\/\/[^\s)\]>]+/g) ?? []).map((url) => url.replace(/[.,]+$/, '')),
    ...((typeof frontmatter.source === 'string' && /^https?:\/\//.test(frontmatter.source)) ? [frontmatter.source] : []),
    ...((typeof frontmatter.url === 'string' && /^https?:\/\//.test(frontmatter.url)) ? [frontmatter.url] : []),
  ])]
  const words = body.trim() ? body.trim().split(/\s+/).length : 0
  return {
    path,
    title: titleFrom(path, body, frontmatter),
    content: body,
    frontmatter,
    headings,
    tables,
    externalLinks,
    wordCount: words,
  }
}

export function recordsFromNote(note: IdeaNote): Array<Record<string, unknown>> {
  const records = note.tables.flatMap((table) => table.rows)
  if (records.length > 0) return records
  const frontmatter = note.frontmatter
  const hasSignalField = ['problem', 'pain', '痛点', 'opportunity', '机会'].some((field) => field in frontmatter)
  if (!hasSignalField) return []
  return [{
    ...frontmatter,
    title: frontmatter.title ?? note.title,
    problem: frontmatter.problem ?? frontmatter.pain ?? frontmatter['痛点'] ?? note.title,
    source: frontmatter.source ?? note.path,
    capturedAt: frontmatter.capturedAt ?? frontmatter.date ?? frontmatter.updated,
  }]
}

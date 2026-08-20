import { parseNote, recordsFromNote } from './markdown.js'
import type { FileSystemLike, IdeaConfig } from './types.js'

function castValue(value: string): string | number | boolean | null {
  const trimmed = value.trim()
  if (trimmed === '') return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed)
  return trimmed
}

export function parseCsv(text: string, delimiter = ','): Array<Record<string, string | number | boolean | null>> {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const next = text[index + 1]
    if (character === '"') {
      if (quoted && next === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (!quoted && character === delimiter) {
      row.push(cell)
      cell = ''
      continue
    }
    if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && next === '\n') index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }
    cell += character ?? ''
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  const headers = (rows.shift() ?? []).map((header, index) => header.trim() || `column_${index + 1}`)
  return rows
    .filter((values) => values.some((value) => value.trim() !== ''))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, castValue(values[index] ?? '')])))
}

function objectRecords(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
  if (typeof value === 'object' && value !== null) return [value as Record<string, unknown>]
  return []
}

export function parseRecords(path: string, text: string): { records: Array<Record<string, unknown>>; warnings: string[] } {
  const extension = path.toLowerCase().split('.').at(-1)
  if (extension === 'csv' || extension === 'tsv') {
    return { records: parseCsv(text, extension === 'tsv' ? '\t' : ',') as Array<Record<string, unknown>>, warnings: [] }
  }
  if (extension === 'jsonl' || extension === 'ndjson') {
    const warnings: string[] = []
    const records: Array<Record<string, unknown>> = []
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!line.trim()) continue
      try {
        records.push(...objectRecords(JSON.parse(line) as unknown))
      } catch {
        warnings.push(`Line ${index + 1} is not valid JSON and was skipped.`)
      }
    }
    return { records, warnings }
  }
  if (extension === 'json') {
    try {
      return { records: objectRecords(JSON.parse(text) as unknown), warnings: [] }
    } catch {
      return { records: [], warnings: ['The JSON file could not be parsed.'] }
    }
  }
  if (extension === 'md' || extension === 'mdown' || extension === 'markdown') {
    const note = parseNote(path, text)
    return { records: recordsFromNote(note), warnings: note.tables.length === 0 ? ['No Markdown table or signal frontmatter was found.'] : [] }
  }
  return { records: [], warnings: [`Unsupported file extension: .${extension ?? 'unknown'}`] }
}

export async function readRecords(
  fs: FileSystemLike,
  config: IdeaConfig,
  path: string,
  signal?: AbortSignal,
): Promise<{ source: string; records: Array<Record<string, unknown>>; warnings: string[] }> {
  const target = await fs.resolve(path, { signal })
  const info = await fs.stat(target, signal)
  if (!info || info.type !== 'file') throw new Error(`Signal source is not a file: ${path}`)
  if ((info.size ?? 0) > config.maxFileBytes) throw new Error(`Signal source exceeds maxFileBytes (${config.maxFileBytes}): ${path}`)
  const text = await fs.readText(target, signal)
  if (text.length > config.maxTextChars) throw new Error(`Signal source exceeds maxTextChars (${config.maxTextChars}): ${path}`)
  const parsed = parseRecords(path, text)
  return { source: path, ...parsed }
}

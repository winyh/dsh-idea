import type { IdeaConfig, SignalSourceType } from './types.js'

export interface WebLike {
  fetch(request: { url: string }, signal?: AbortSignal): Promise<{
    url: string
    statusCode: number
    body: { kind: string; content: string }
    truncated?: boolean
  }>
}

export interface ExternalSourceSnapshot {
  url: string
  finalUrl?: string
  statusCode?: number
  sourceType: SignalSourceType
  fetchedAt: string
  title: string
  description: string
  headings: string[]
  excerpt: string
  contentKind?: string
  truncated: boolean
  warnings: string[]
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function cleanText(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
}

function metaContent(html: string, name: string): string {
  const pattern = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i')
  const reversePattern = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["'][^>]*>`, 'i')
  return cleanText(pattern.exec(html)?.[1] ?? reversePattern.exec(html)?.[1] ?? '')
}

function htmlSnapshot(html: string, maxChars: number): { title: string; description: string; headings: string[]; excerpt: string } {
  const title = cleanText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
  const description = metaContent(html, 'description')
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((match) => cleanText(match[1] ?? ''))
    .filter(Boolean)
    .slice(0, 20)
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  return { title, description, headings, excerpt: cleanText(body).slice(0, maxChars) }
}

function inferSourceType(url: string, requested?: SignalSourceType): SignalSourceType {
  if (requested) return requested
  const host = new URL(url).hostname.toLowerCase()
  if (host.includes('reddit') || host.includes('news.ycombinator') || host.includes('forum')) return 'community'
  if (host.includes('github')) return 'issue'
  if (host.includes('g2') || host.includes('capterra') || host.includes('appstore')) return 'review'
  if (host.includes('trends') || host.includes('explodingtopics')) return 'search'
  if (host.includes('competitor')) return 'competitor'
  return 'other'
}

export async function fetchExternalSources(
  web: WebLike,
  urls: string[],
  config: IdeaConfig,
  requestedSourceType?: SignalSourceType,
  signal?: AbortSignal,
): Promise<{ sources: ExternalSourceSnapshot[]; warnings: string[] }> {
  const uniqueUrls = [...new Set(urls.map((url) => url.trim()).filter(Boolean))].slice(0, config.maxExternalUrls)
  const warnings: string[] = []
  const sources: ExternalSourceSnapshot[] = []
  for (const url of uniqueUrls) {
    let parsed: URL
    try {
      parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('only HTTP(S) URLs are supported')
    } catch (error) {
      warnings.push(`Skipped invalid external URL '${url}': ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    try {
      const result = await web.fetch({ url: parsed.toString() }, signal)
      const html = result.body.content
      const extracted = result.body.kind === 'html'
        ? htmlSnapshot(html, config.maxExternalChars)
        : { title: '', description: '', headings: [], excerpt: cleanText(html).slice(0, config.maxExternalChars) }
      sources.push({
        url: parsed.toString(),
        finalUrl: result.url,
        statusCode: result.statusCode,
        sourceType: inferSourceType(parsed.toString(), requestedSourceType),
        fetchedAt: new Date().toISOString(),
        ...extracted,
        contentKind: result.body.kind,
        truncated: Boolean(result.truncated) || html.length > config.maxExternalChars,
        warnings: result.statusCode >= 400 ? [`HTTP status ${result.statusCode}`] : [],
      })
    } catch (error) {
      warnings.push(`Could not fetch '${parsed.toString()}': ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (urls.length > config.maxExternalUrls) warnings.push(`Only the first ${config.maxExternalUrls} external URLs were scanned.`)
  return { sources, warnings }
}

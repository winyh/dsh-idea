import { Context, Service } from '@deepseek-ai/cordis'
import { readRecords } from './data.js'
import { normalizeSignals, filterSignals, buildOpportunityMap, generateCandidates } from './signals.js'
import type { FileSystemLike, IdeaCandidate, IdeaConfig, IdeaSignal, SignalFilter } from './types.js'

export interface IdeaDiscoveryServiceApi {
  importSignals(path: string, signal?: AbortSignal): Promise<{ source: string; signals: IdeaSignal[]; warnings: string[]; rowsRead: number; rowsAccepted: number }>
  filterSignals(path: string, filter?: SignalFilter, signal?: AbortSignal): Promise<{ source: string; signals: IdeaSignal[]; warnings: string[] }>
  buildMap(path: string, filter?: SignalFilter, signal?: AbortSignal): Promise<ReturnType<typeof buildOpportunityMap>>
  generateCandidates(path: string, filter?: SignalFilter, maxPerTheme?: number, signal?: AbortSignal): Promise<{ source: string; themes: ReturnType<typeof buildOpportunityMap>['themes']; candidates: IdeaCandidate[]; warnings: string[] }>
}

export class IdeaDiscoveryService extends Service<IdeaDiscoveryServiceApi> implements IdeaDiscoveryServiceApi {
  private readonly fs: FileSystemLike
  private readonly config: IdeaConfig

  constructor(ctx: Context, fs: FileSystemLike, config: IdeaConfig) {
    super(ctx, 'idea-discovery')
    this.fs = fs
    this.config = config
  }

  async importSignals(path: string, signal?: AbortSignal) {
    const imported = await readRecords(this.fs, this.config, path, signal)
    const normalized = normalizeSignals(imported.records, path)
    return {
      source: path,
      signals: normalized.signals,
      warnings: [...imported.warnings, ...(normalized.skipped > 0 ? [`Skipped ${normalized.skipped} rows without a problem/pain field.`] : [])],
      rowsRead: imported.records.length,
      rowsAccepted: normalized.signals.length,
    }
  }

  async filterSignals(path: string, filter: SignalFilter = {}, signal?: AbortSignal) {
    const imported = await this.importSignals(path, signal)
    return { source: path, signals: filterSignals(imported.signals, filter), warnings: imported.warnings }
  }

  async buildMap(path: string, filter: SignalFilter = {}, signal?: AbortSignal) {
    const selected = await this.filterSignals(path, filter, signal)
    return buildOpportunityMap(selected.signals, path)
  }

  async generateCandidates(path: string, filter: SignalFilter = {}, maxPerTheme = 2, signal?: AbortSignal) {
    const map = await this.buildMap(path, filter, signal)
    return { source: path, themes: map.themes, candidates: generateCandidates(map.themes, maxPerTheme), warnings: [...map.warnings] }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'idea-discovery': IdeaDiscoveryServiceApi
  }

  interface Events {
    'idea/analysis-started'(payload: { kind: string; source?: string }): void
    'idea/analysis-completed'(payload: { kind: string; source?: string; warningCount: number }): void
    'idea/warning'(payload: { kind: string; source?: string; message: string }): void
  }
}

export type SignalSourceType = 'interview' | 'support' | 'community' | 'review' | 'issue' | 'search' | 'competitor' | 'survey' | 'other'
export type DiscoverySourceId = 'product-hunt' | 'trustmrr' | 'reddit' | 'g2' | 'github' | 'google-trends' | 'app-reviews' | 'job-boards' | 'policy'
export type InterviewMethod = 'jtbd' | 'mom-test' | 'switching' | 'critical-event'
export type EvidenceStrength = 'weak' | 'medium' | 'strong'
export type EvidenceState = 'signal' | 'inference' | 'validated'
export type SignalSort = 'latest' | 'repeat' | 'pain' | 'verifiable'
export type ReadinessStatus = 'ready' | 'partial' | 'missing' | 'not-applicable'

export type Primitive = string | number | boolean | null
export type Row = Record<string, Primitive | Primitive[] | Record<string, unknown> | undefined>

export interface IdeaConfig {
  defaultRoot: string
  reportDir: string
  maxFiles: number
  maxRows: number
  maxFileBytes: number
  maxTextChars: number
  maxResultChars: number
  defaultLanguage: string
  defaultSort: SignalSort
  maxExternalUrls: number
  maxExternalChars: number
  requestTimeoutMs: number
}

export interface FileSystemLike {
  resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<unknown>
  contains(parent: unknown, child: unknown): boolean
  stat(target: unknown, signal?: AbortSignal): Promise<{ type: string; size?: number; version: unknown } | undefined>
  readText(target: unknown, signal?: AbortSignal): Promise<string>
  listDir(target: unknown, signal?: AbortSignal): Promise<Array<{
    name: string
    type: string
    target: unknown
    size?: number
  }>>
  writeText(target: unknown, content: string, expected?: unknown, signal?: AbortSignal): Promise<unknown>
}

export interface Frontmatter {
  [key: string]: unknown
}

export interface MarkdownTable {
  headers: string[]
  rows: Array<Record<string, string>>
}

export interface IdeaNote {
  path: string
  title: string
  content: string
  frontmatter: Frontmatter
  headings: string[]
  tables: MarkdownTable[]
  externalLinks: string[]
  wordCount: number
}

export interface IdeaSignal {
  id: string
  title: string
  problem: string
  user: string
  scene: string
  source: string
  sourceType: SignalSourceType
  sourceUrl?: string
  capturedAt?: string
  quote?: string
  behavior?: string
  workaround?: string
  cost?: string
  paymentSignal?: string
  whyNow?: string
  painScore?: number
  repeatCount?: number
  tags: string[]
  evidenceStrength: EvidenceStrength
  evidenceState: EvidenceState
  notes?: string
}

export interface SignalFilter {
  query?: string
  user?: string
  scene?: string
  sourceType?: SignalSourceType
  minPain?: number
  minRepeat?: number
  since?: string
  sort?: SignalSort
  limit?: number
}

export interface SignalImportResult {
  source: string
  signals: IdeaSignal[]
  warnings: string[]
  rowsRead: number
  rowsAccepted: number
}

export interface SignalQuality {
  score: number
  evidenceStrength: EvidenceStrength
  missing: string[]
  reasons: string[]
}

export interface OpportunityTheme {
  id: string
  title: string
  user: string
  scene: string
  opportunity: string
  signalCount: number
  totalRepeatCount: number
  averagePainScore: number | null
  evidenceScore: number
  signalIds: string[]
  representativeProblems: string[]
  currentWorkarounds: string[]
  risks: string[]
}

export interface OpportunityMap {
  generatedAt: string
  source: string
  signalsConsidered: number
  themes: OpportunityTheme[]
  warnings: string[]
  nextActions: string[]
}

export type IdeaSolutionLens = 'automation' | 'copilot' | 'workflow' | 'marketplace' | 'education'

export interface IdeaCandidate {
  id: string
  themeId: string
  title: string
  user: string
  scene: string
  problem: string
  solutionLens: IdeaSolutionLens
  solution: string
  whyNow: string
  evidence: string[]
  riskiestAssumption: string
  score: {
    problem: number
    evidence: number
    reachability: number | null
    feasibility: number | null
    testability: number
  }
  confidence: 'low' | 'medium' | 'high'
  nextTest: string
}

export interface ExperimentPlan {
  candidateId: string
  hypothesis: string
  riskiestAssumption: string
  method: 'interview' | 'concierge' | 'prototype' | 'landing-page' | 'preorder' | 'technical-spike'
  audience: string
  steps: string[]
  evidenceToCollect: string[]
  successThreshold: string
  failureThreshold: string
  duration: string
  decisionRule: string
  guardrails: string[]
}

export interface IdeaFileSummary {
  path: string
  extension: string
  size: number
  status: 'supported' | 'skipped' | 'error'
  reason?: string
}

export interface IdeaOnboardingResult {
  generatedAt: string
  root: string
  overallStatus: 'ready' | 'partial' | 'blocked'
  overallScore: number
  sources: {
    files: number
    signalFiles: number
    signals: number
    sourceTypes: string[]
  }
  dimensions: Array<{
    id: string
    label: string
    status: ReadinessStatus
    score: number | null
    evidence: string[]
    missing: string[]
    nextAction: string
  }>
  sop: {
    currentStep: 'context' | 'signals' | 'synthesis' | 'validation' | 'review'
    steps: Array<{
      id: 'context' | 'signals' | 'synthesis' | 'validation' | 'review'
      order: number
      status: ReadinessStatus
      objective: string
      tool: string
      prompt: string
    }>
  }
  topActions: string[]
  questions: string[]
  warnings: string[]
}

export interface IdeaReviewResult {
  generatedAt: string
  source: string
  filter: SignalFilter
  signalImport: SignalImportResult
  quality: {
    strongSignals: number
    mediumSignals: number
    weakSignals: number
    evidenceGaps: string[]
  }
  opportunityMap: OpportunityMap
  candidates: IdeaCandidate[]
  recommendedCandidate?: IdeaCandidate
  experiment?: ExperimentPlan
  warnings: string[]
  nextActions: string[]
}

export interface SourcePlanItem {
  id: DiscoverySourceId
  name: string
  purpose: string
  suggestedUrl: string
  queryTemplates: string[]
  inspect: string[]
  evidenceType: string
  bias: string
}

export interface EvidenceComponent {
  id: string
  label: string
  score: number
  maxScore: number
  observed: boolean
  explanation: string
}

export interface EvidenceScore {
  signalId: string
  score: number
  strength: EvidenceStrength
  demandStage: 'inspiration' | 'problem-signal' | 'behavior-backed' | 'commercial-signal'
  components: EvidenceComponent[]
  missing: string[]
  reasons: string[]
  warnings: string[]
}

export interface InterviewGuide {
  method: InterviewMethod
  title: string
  objective: string
  opening: string
  questions: string[]
  captureFields: string[]
  avoid: string[]
  nextActions: string[]
}

export interface OpportunitySolutionTree {
  generatedAt: string
  goal: string
  outcome: string
  opportunities: Array<{
    id: string
    title: string
    evidenceScore: number
    signalCount: number
    problems: string[]
    solutions: Array<{
      id: string
      title: string
      assumption: string
      experiment: ExperimentPlan
    }>
  }>
  openQuestions: string[]
  warnings: string[]
  nextActions: string[]
}

export interface IdeaWatchlistDiff {
  artifactType: 'idea-watchlist-diff'
  generatedAt: string
  items: Array<{
    url: string
    status: 'new' | 'changed' | 'unchanged' | 'failed'
    changedFields: string[]
    currentFetchedAt?: string
    previousFetchedAt?: string
    title?: string
    excerpt?: string
    warning?: string
  }>
  warnings: string[]
  nextActions: string[]
  markdown: string
}

import { buildExperiment } from './signals.js'
import type {
  DiscoverySourceId,
  EvidenceComponent,
  EvidenceScore,
  EvidenceStrength,
  IdeaReviewResult,
  IdeaSignal,
  InterviewGuide,
  InterviewMethod,
  OpportunitySolutionTree,
  SourcePlanItem,
} from './types.js'

const sourceOrder: DiscoverySourceId[] = [
  'product-hunt',
  'trustmrr',
  'reddit',
  'g2',
  'github',
  'google-trends',
  'app-reviews',
  'job-boards',
  'policy',
]

const sourceCatalog: Record<DiscoverySourceId, Omit<SourcePlanItem, 'queryTemplates'>> = {
  'product-hunt': {
    id: 'product-hunt',
    name: 'Product Hunt',
    purpose: '观察新解法、早期采用者、产品定位、评论中的缺口和 maker 回复。',
    suggestedUrl: 'https://www.producthunt.com/',
    inspect: ['同一类别近期发布', '评论中的 missing / alternative / too hard', '用户追问和 maker 回复', '产品定位、价格和分发方式'],
    evidenceType: '解决方案地图、早期市场语言和定位线索',
    bias: '发布热度和社区关注不等于留存、支付意愿或完整市场需求。',
  },
  trustmrr: {
    id: 'trustmrr',
    name: 'TrustMRR',
    purpose: '观察已商业化的 SaaS、应用和数字业务，以及价格、收入、技术栈和分发线索。',
    suggestedUrl: 'https://trustmrr.com/',
    inspect: ['类别和细分人群', '收入/增长和价格区间', '技术栈与营销渠道', '最近上架项目及其价值主张'],
    evidenceType: '市场存在、价格锚点、商业化和分发线索',
    bias: '上架项目有选择偏差；收入口径需要核对，不能把项目直接当作可复制机会。',
  },
  reddit: {
    id: 'reddit',
    name: 'Reddit',
    purpose: '发现用户原话、具体场景、抱怨、替代方案和 workaround。',
    suggestedUrl: 'https://www.reddit.com/',
    inspect: ['垂直 subreddit 的上下文', 'how do I / alternative / frustrated / manually', '评论里的补充场景和替代产品', '用户是否描述了时间、金钱或风险代价'],
    evidenceType: '原生问题语言、用户场景和替代方案',
    bias: '单个社区不代表整个市场；需遵守版规，不把研究变成骚扰或营销。',
  },
  g2: {
    id: 'g2',
    name: 'G2',
    purpose: '从 B2B 软件评论中发现低评分原因、实施障碍、集成缺口和迁移需求。',
    suggestedUrl: 'https://www.g2.com/',
    inspect: ['1–3 星评论', 'Pros / Cons', '替代产品和迁移经历', '实施、集成、价格和支持问题'],
    evidenceType: '购买后反馈、产品缺口和迁移原因',
    bias: '评论有平台和样本偏差；评分不能单独证明机会或支付意愿。',
  },
  github: {
    id: 'github',
    name: 'GitHub Issues / Discussions',
    purpose: '发现开发者工具、API 和开源生态中的可复现缺口。',
    suggestedUrl: 'https://github.com/',
    inspect: ['重复 Issue 和 Feature Request', '复现步骤和 workaround', 'upvotes、标签和讨论上下文', '维护者是否回应以及生态限制'],
    evidenceType: '技术痛点、生态需求和可复现缺口',
    bias: '开源用户不等于付费用户；需求可能受项目路线和维护能力限制。',
  },
  'google-trends': {
    id: 'google-trends',
    name: 'Google Trends',
    purpose: '观察关键词相对兴趣、地区差异、季节性和“为什么是现在”的线索。',
    suggestedUrl: 'https://trends.google.com/trends/',
    inspect: ['3–5 个同义词和替代词的比较', '时间趋势和季节性', '地区差异', '相关查询和新出现的表达'],
    evidenceType: '关注变化、市场教育和用户搜索语言',
    bias: '相对搜索兴趣不是销量、市场规模或支付意愿。',
  },
  'app-reviews': {
    id: 'app-reviews',
    name: 'App Store / Google Play Reviews',
    purpose: '发现移动场景中的版本回归、使用障碍和替代需求。',
    suggestedUrl: 'https://play.google.com/store',
    inspect: ['1–3 星评论', '版本更新前后的问题变化', '重复抱怨和功能缺口', '用户是否提到替代应用'],
    evidenceType: '移动端真实使用反馈和版本相关问题',
    bias: '评论者是主动反馈人群；低评分可能来自一次性故障或期望落差。',
  },
  'job-boards': {
    id: 'job-boards',
    name: '招聘信息与服务市场',
    purpose: '从反复出现的岗位职责、技能和外包需求中发现昂贵的内部工作流。',
    suggestedUrl: 'https://www.indeed.com/',
    inspect: ['反复出现的手工流程', '合规、报表、对账和数据整理职责', '企业愿意持续付费的人力成本', '可被工具替代或增强的步骤'],
    evidenceType: '组织预算、工作流和触达入口线索',
    bias: '岗位描述是企业表达，不等于员工实际痛点；需要访谈或观察复核。',
  },
  policy: {
    id: 'policy',
    name: '政策、标准与行业变化',
    purpose: '发现因法规、标准、补贴、技术成本或供应链变化产生的新任务。',
    suggestedUrl: 'https://www.regulations.gov/',
    inspect: ['新义务和截止日期', '受影响的角色和组织', '合规成本与现有解决方式', '区域、语言和行业边界'],
    evidenceType: '外部变化、强制性任务和为什么是现在',
    bias: '政策变化不必然形成可支付产品；需要验证受影响者的工作量和预算。',
  },
}

function fill(template: string, context: { topic: string; targetUser: string; market: string; region: string }): string {
  return template
    .replaceAll('{topic}', context.topic)
    .replaceAll('{user}', context.targetUser || '目标用户')
    .replaceAll('{market}', context.market || '目标市场')
    .replaceAll('{region}', context.region || '目标地区')
}

function queriesFor(id: DiscoverySourceId, context: { topic: string; targetUser: string; market: string; region: string }): string[] {
  const templates: Record<DiscoverySourceId, string[]> = {
    'product-hunt': [
      '{topic} Product Hunt launch',
      'site:producthunt.com {topic} alternative missing',
      '{topic} Product Hunt comments too hard expensive integration',
    ],
    trustmrr: [
      'site:trustmrr.com {topic} startup SaaS',
      'TrustMRR {topic} category revenue pricing',
      '{topic} SaaS recently listed pricing tech stack',
    ],
    reddit: [
      'site:reddit.com {topic} "how do I"',
      'site:reddit.com {topic} alternative frustrated manually',
      'site:reddit.com/r/{market} {topic} too expensive workaround',
    ],
    g2: [
      'site:g2.com {topic} reviews cons alternative integration',
      'site:g2.com {topic} "what do you dislike"',
      '{topic} G2 low rating implementation pricing',
    ],
    github: [
      'site:github.com/issues {topic} feature request workaround',
      'site:github.com {topic} issue alternative API missing',
      '{topic} GitHub Discussions integration pain',
    ],
    'google-trends': [
      'Google Trends compare {topic} alternatives {region}',
      '{topic} related searches {market}',
      '{topic} seasonality demand {region}',
    ],
    'app-reviews': [
      '{topic} app reviews missing feature alternative',
      '{topic} Google Play 1 star review problem',
      '{topic} App Store reviews sync crash expensive',
    ],
    'job-boards': [
      '{market} {topic} job description manual workflow',
      '{topic} operations coordinator spreadsheet reporting job',
      '{topic} freelance service outsourcing pain',
    ],
    policy: [
      '{market} {topic} regulation compliance deadline',
      '{topic} standard reporting requirement {region}',
      '{topic} policy change operational impact',
    ],
  }
  return (templates[id] ?? []).map((template) => fill(template, context))
}

export function buildSourcePlan(input: {
  topic: string
  targetUser?: string
  market?: string
  region?: string
  goal?: string
  sourceIds?: DiscoverySourceId[]
}): { externalFirst: true; context: Record<string, string>; sources: SourcePlanItem[]; researchSequence: string[]; evidenceGate: string[]; warnings: string[] } {
  const context = {
    topic: input.topic.trim(),
    targetUser: input.targetUser?.trim() || '',
    market: input.market?.trim() || '',
    region: input.region?.trim() || '',
  }
  const ids = input.sourceIds?.length ? [...new Set(input.sourceIds)] : sourceOrder.slice(0, 6)
  const sources = ids.map((id) => ({
    ...sourceCatalog[id],
    queryTemplates: queriesFor(id, context),
  }))
  return {
    externalFirst: true,
    context,
    sources,
    researchSequence: [
      '先用 Product Hunt / TrustMRR 建立解法和商业化地图。',
      '再用 Reddit / G2 / GitHub / 应用评论寻找用户原话、具体行为和 workaround。',
      '最后用 Google Trends、招聘、政策和竞品变化判断为什么是现在。',
      '至少用两个不同来源类型交叉验证一个机会，再进入 Idea 和实验阶段。',
    ],
    evidenceGate: [
      '具体行为优先于未来愿望。',
      '重复出现、时间/金钱/风险代价和当前 workaround 会提高证据强度。',
      '来源热度不等于需求成立，商业化线索也不等于可复制机会。',
      '每个结论记录来源 URL、发布日期或抓取时间、地区和证据限制。',
    ],
    warnings: input.goal?.trim() ? [] : ['尚未明确研究目标；默认同时观察需求、市场和商业化线索。'],
  }
}

function component(id: string, label: string, score: number, maxScore: number, observed: boolean, explanation: string): EvidenceComponent {
  return { id, label, score, maxScore, observed, explanation }
}

function repeatScore(repeatCount: number): number {
  if (repeatCount >= 5) return 10
  if (repeatCount >= 3) return 8
  if (repeatCount >= 2) return 5
  if (repeatCount >= 1) return 2
  return 0
}

function crossSourceScore(signal: IdeaSignal, signals: IdeaSignal[]): { score: number; explanation: string } {
  const related = signals.filter((candidate) => candidate.user === signal.user && candidate.scene === signal.scene)
  const distinct = new Set(related.map((candidate) => candidate.sourceUrl || `${candidate.sourceType}:${candidate.source}`)).size
  if (distinct >= 3) return { score: 15, explanation: '同一用户/场景下有至少三个可区分来源或来源类型。' }
  if (distinct >= 2) return { score: 8, explanation: '同一用户/场景下有两个可区分来源或来源类型。' }
  return { score: 0, explanation: '暂未形成跨来源复核。' }
}

export function scoreSignalEvidence(signal: IdeaSignal, signals: IdeaSignal[] = [signal]): EvidenceScore {
  const crossSource = crossSourceScore(signal, signals)
  const components = [
    component('behavior', '具体行为', signal.behavior ? 20 : 0, 20, Boolean(signal.behavior), signal.behavior ? '记录了用户实际做过什么。' : '缺少最近一次真实行为或关键事件。'),
    component('workaround', '当前 workaround', signal.workaround ? 15 : 0, 15, Boolean(signal.workaround), signal.workaround ? '记录了用户现在如何绕路解决。' : '还不知道用户目前如何解决。'),
    component('cost', '时间/金钱/风险代价', signal.cost ? 15 : 0, 15, Boolean(signal.cost), signal.cost ? '有明确代价描述。' : '没有量化或具体化损失。'),
    component('payment', '支付/迁移/承诺信号', signal.paymentSignal ? 10 : 0, 10, Boolean(signal.paymentSignal), signal.paymentSignal ? '出现了付费、迁移、预订或时间承诺。' : '尚无商业或承诺证据。'),
    component('repeat', '重复出现', repeatScore(signal.repeatCount ?? 0), 10, (signal.repeatCount ?? 0) >= 2, (signal.repeatCount ?? 0) >= 2 ? `重复提及约 ${signal.repeatCount} 次。` : '重复性不足或未记录。'),
    component('source', '可追溯来源', signal.sourceUrl ? 10 : 0, 10, Boolean(signal.sourceUrl), signal.sourceUrl ? '可以回到原始页面或访谈记录。' : '缺少可追溯 URL 或记录位置。'),
    component('why-now', '为什么是现在', signal.whyNow ? 5 : 0, 5, Boolean(signal.whyNow), signal.whyNow ? '记录了触发变化或时间窗口。' : '还没有解释触发因素或时间窗口。'),
    component('cross-source', '跨来源复核', crossSource.score, 15, crossSource.score > 0, crossSource.explanation),
  ]
  const total = components.reduce((sum, item) => sum + item.score, 0)
  const max = components.reduce((sum, item) => sum + item.maxScore, 0)
  const score = Math.round((total / max) * 100)
  const strength: EvidenceStrength = score >= 70 ? 'strong' : score >= 45 ? 'medium' : 'weak'
  const demandStage: EvidenceScore['demandStage'] = signal.paymentSignal
    ? 'commercial-signal'
    : signal.behavior && signal.workaround && (signal.repeatCount ?? 0) >= 2
      ? 'behavior-backed'
      : signal.sourceUrl || signal.behavior || signal.workaround
        ? 'problem-signal'
        : 'inspiration'
  const missing = components.filter((item) => !item.observed).map((item) => item.label)
  const reasons = components.filter((item) => item.observed).map((item) => item.explanation)
  const warnings = [
    ...(signal.sourceType === 'community' || signal.sourceType === 'review' ? ['公开讨论或评论需要第二来源复核，不能直接代表整个市场。'] : []),
    ...(signal.paymentSignal ? [] : ['尚无支付、迁移或明确承诺证据。']),
  ]
  return { signalId: signal.id, score, strength, demandStage, components, missing, reasons, warnings }
}

export function scoreSignalSet(signals: IdeaSignal[]): { scores: EvidenceScore[]; summary: { count: number; strong: number; medium: number; weak: number; commercialSignals: number; crossValidated: number }; warnings: string[] } {
  const scores = signals.map((signal) => scoreSignalEvidence(signal, signals))
  const summary = {
    count: scores.length,
    strong: scores.filter((item) => item.strength === 'strong').length,
    medium: scores.filter((item) => item.strength === 'medium').length,
    weak: scores.filter((item) => item.strength === 'weak').length,
    commercialSignals: scores.filter((item) => item.demandStage === 'commercial-signal').length,
    crossValidated: scores.filter((item) => item.components.some((component) => component.id === 'cross-source' && component.observed)).length,
  }
  return {
    scores,
    summary,
    warnings: signals.length === 0
      ? ['没有可评分的 signal；先导入或提炼外部来源中的具体行为。']
      : ['证据评分用于排序和暴露缺口，不等于市场规模、支付意愿或产品市场匹配。'],
  }
}

const interviewQuestions: Record<InterviewMethod, string[]> = {
  jtbd: [
    '请讲最近一次你需要完成这件事的完整过程。',
    '当时发生了什么触发事件？你想推进什么进展？',
    '你先做了什么，之后又做了什么？哪里最费力或不确定？',
    '你现在用哪些产品、人工方法或替代方案？',
    '如果换方案，你最担心什么？什么结果会让你觉得值得？',
  ],
  'mom-test': [
    '最近一次遇到这个问题是什么时候？请从头讲一遍。',
    '你当时花了多少时间、钱或人力？',
    '你试过哪些解决方式？为什么没有继续？',
    '这个问题多久发生一次？上一次是什么时候？',
    '谁还会受到影响？谁参与决定或付费？',
  ],
  switching: [
    '是什么事件让你开始寻找替代方案？',
    '原方案哪里让你失望或无法继续？',
    '什么因素吸引你尝试新方案？什么让你犹豫？',
    '迁移过程中付出了什么成本？最终如何做决定？',
    '还有哪些人或场景没有迁移？为什么？',
  ],
  'critical-event': [
    '请描述最近一次问题真正影响结果的事件。',
    '问题发生前、发生时、发生后分别做了什么？',
    '当时谁发现了问题，谁承担了后果？',
    '你如何判断事情是否解决？',
    '如果下次再发生，哪些条件会让你提前处理？',
  ],
}

export function buildInterviewGuide(input: { method: InterviewMethod; targetUser: string; job?: string; scene?: string; knownSignal?: string }): InterviewGuide {
  const labels: Record<InterviewMethod, string> = {
    jtbd: 'JTBD 进展访谈',
    'mom-test': 'The Mom Test 非引导式访谈',
    switching: 'Switching 切换访谈',
    'critical-event': '关键事件访谈',
  }
  const focus = [input.targetUser, input.scene, input.job].filter(Boolean).join(' / ')
  return {
    method: input.method,
    title: labels[input.method],
    objective: `围绕${focus || '目标场景'}，还原真实行为、当前替代方案、代价和触发变化，而不是收集功能愿望。`,
    opening: `我正在研究${focus || '这个场景'}，不会向你推销方案。请只讲最近真实发生过的经历；如果没有发生过，也请直接说没有。`,
    questions: [
      ...interviewQuestions[input.method],
      ...(input.knownSignal ? [`针对已知信号“${input.knownSignal}”，请讲一个最近发生的具体例子。`] : []),
    ],
    captureFields: ['原话和最近一次事件', '触发因素/为什么是现在', '步骤和实际行为', '当前 workaround/替代方案', '时间、金钱、风险和情绪代价', '使用者、决策者、付费者', '继续测试、迁移或付费承诺', '仍需交叉验证的假设'],
    avoid: ['不要先展示完整方案或功能清单。', '不要把“听起来不错”当成需求证据。', '不要只访谈满意用户；优先包含流失、迁移和人工 workaround 用户。', '不要记录超出研究所需的个人敏感信息。'],
    nextActions: ['将访谈整理为 signal card，并保留原话、日期和来源。', '用 idea_evidence_score 判断证据缺口。', '至少和一个公开来源或第二位用户交叉验证，再进入机会树。'],
  }
}

export function buildOpportunitySolutionTree(review: IdeaReviewResult, goal?: string): OpportunitySolutionTree {
  const opportunities = review.opportunityMap.themes.map((theme) => {
    const candidates = review.candidates.filter((candidate) => candidate.themeId === theme.id)
    return {
      id: theme.id,
      title: theme.title,
      evidenceScore: theme.evidenceScore,
      signalCount: theme.signalCount,
      problems: theme.representativeProblems,
      solutions: candidates.map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        assumption: candidate.riskiestAssumption,
        experiment: buildExperiment(candidate),
      })),
    }
  })
  const outcome = goal?.trim() || '在外部目标市场中找到一个有真实行为证据、可触达且能在 7 天内验证的机会。'
  return {
    generatedAt: new Date().toISOString(),
    goal: goal?.trim() || '外部机会与真实需求发现',
    outcome,
    opportunities,
    openQuestions: [
      '哪些机会已经有跨来源证据，哪些仍只有单条公开信号？',
      '目标用户现在付出了什么成本，为什么还没有采用更好的替代方案？',
      '哪个候选解法可以用人工服务、原型或预售在 7 天内证伪？',
      '谁可以最快被触达，谁拥有预算或决策权？',
    ],
    warnings: [
      ...(opportunities.length === 0 ? ['没有机会主题；先补充外部信号或用户访谈。'] : []),
      '机会树中的解法仍是候选假设，不代表需求或支付意愿已经成立。',
    ],
    nextActions: opportunities.length > 0
      ? ['选择证据最强且验证成本最低的机会。', '对一个候选解法运行 idea_experiment_plan。', '实验后记录继续、调整或暂停的决策。']
      : ['先运行 idea_source_plan 或 idea_opportunity_radar，收集至少两个来源类型的外部信号。'],
  }
}

export function getSourceCatalog(): SourcePlanItem[] {
  return sourceOrder.map((id) => ({ ...sourceCatalog[id], queryTemplates: [] }))
}

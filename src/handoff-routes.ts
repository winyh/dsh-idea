import type { HandoffRoute } from './handoff-receive.js'

// Locally owned contract; no shared runtime package or cross-repository import.
export const handoffRoutes: Record<string, HandoffRoute> = {
  "sales-feedback-handoff": {
    "from": "dsh-sales",
    "nextTool": "idea_evidence_score",
    "purpose": "把失单与市场问题作为新发现线索，补访谈和反证，不把原因频次当成需求验证。",
    "text": [
      "source"
    ],
    "lists": [
      "feedback"
    ],
    "mode": "direct"
  }
}

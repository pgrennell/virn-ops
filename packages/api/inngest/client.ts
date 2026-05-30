// packages/api/inngest/client.ts
//
// Phase 18 core -- Inngest client. The runtime that drives:
//   - Scheduled functions (SLA sweep migrated from Vercel Cron in this phase;
//     re-attestation sweep similarly migratable in a follow-up).
//   - Event-driven functions (automation_rule executor + Playbooks dispatcher
//     are the next-up consumers in phase 18 follow-ups).
//
// Why Inngest now: the v1 reference automations for the property-ops pack
// (Phase 17 ref-automations) + Playbooks execution (Phase 18b) + SLA sweep
// migration combine into "three features justify the runtime" -- the
// threshold from BUILD_PLAN §Phase 18.
//
// Env: the client picks up INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY from the
// environment. In dev (no keys set), Inngest defaults to the local Dev Server
// at http://localhost:8288; the SDK probes and falls back cleanly.

import { Inngest } from "inngest";

/** Single org-wide Inngest client. The `id` becomes the app slug in Inngest's
 * dashboard; keep stable across deploys so the function registry doesn't
 * fragment on rename. */
export const inngest = new Inngest({
	id: "virn-ops",
});

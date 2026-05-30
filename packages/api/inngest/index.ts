// packages/api/inngest/index.ts
//
// Phase 18 core -- Inngest entry barrel. The Next.js endpoint at
// apps/saas/app/api/inngest/route.ts mounts these via inngest/next's
// `serve()` handler.

import { slaSweepScheduled } from "./functions/sla-sweep";

export { inngest } from "./client";

/** All Inngest functions exported to the serve handler. Append new functions
 * here as they ship -- the registry is the only place that needs to know the
 * complete list. */
export const functions = [slaSweepScheduled];

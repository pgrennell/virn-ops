// apps/saas/modules/builder/lib/types.ts
//
// Derived types for the Workflow Builder canvas. We pull `VersionEditBundleResponse`
// from the oRPC client's inferred return type rather than hand-inlining the Drizzle
// row shape -- the hand-inlined version drifted from the actual response (it was
// missing every workflow row column added by migrations + the timestamps), and the
// drift only surfaces at cache write time (setQueryData strictness). Inferring keeps
// the client + the API in lockstep.

import type { orpc } from "@shared/lib/orpc-query-utils";

/** The full bundle the canvas reads. Pulled straight from the oRPC client so it
 * always matches what the cache holds + what server-side procedures return. */
export type VersionEditBundleResponse = Awaited<
	ReturnType<typeof orpc.workflows.getVersionBundle.call>
>;

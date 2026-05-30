// apps/saas/app/api/inngest/route.ts
//
// Phase 18 core -- Inngest serve endpoint. Inngest's dashboard discovers
// registered functions by POSTing to this URL with INNGEST_SIGNING_KEY.
// Local dev: the Inngest Dev Server at http://localhost:8288 also probes
// this endpoint when started with `pnpm dlx inngest-cli@latest dev`.
//
// PUT is the registration handshake; GET is health/introspection; POST is
// function invocation. The serve() handler exposes all three.

import { functions, inngest } from "@virn/api/inngest";
import { serve } from "inngest/next";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = serve({
	client: inngest,
	functions,
});

export const GET = handler;
export const POST = handler;
export const PUT = handler;

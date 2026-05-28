import { z } from "zod";

import { enforceRateLimit } from "../../../orpc/rate-limit";
import { publicProcedure } from "../../../orpc/procedures";
import { getRunForGuest } from "../lib/guest";
import { runEngineCall } from "./_utils";

// POST (not GET) so the token rides in the request body, never in a query string where it
// could land in access logs, browser history, or referrer headers.
export const getRunForGuestProc = publicProcedure
	.route({
		method: "POST",
		path: "/runs/guest/get",
		tags: ["Runs"],
		summary: "Get a guest's narrowed view of a run via participant token",
		description:
			"Public endpoint: caller supplies the plaintext participant token (issued by an org admin and delivered via URL fragment to the guest). Returns ONLY the guest's assigned steps, their step-scoped fields, and minimal run context. Never leaks other participants, other steps, kickoff data, or the workflow graph. Rate-limited by IP. Optional `candidateReturnUrl` (D-037) is validated server-side against the org's outbound_webhook_credential return-URL allowlist; the response carries the validated URL or null.",
	})
	.input(
		z.object({
			token: z.string().min(32).max(200),
			// D-037 link-out + return convention. Frontend reads this from
			// `?returnUrl=` on the guest page and passes it through. Server-side
			// validation against the org's allowlist is the source of truth; the
			// client never decides whether to honor the URL on its own.
			candidateReturnUrl: z.string().url().max(2000).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		enforceRateLimit(context.headers, {
			key: "guest:get-run",
			limit: 60,
			windowMs: 60_000,
		});
		return await runEngineCall(() =>
			getRunForGuest(input.token, input.candidateReturnUrl ?? null),
		);
	});

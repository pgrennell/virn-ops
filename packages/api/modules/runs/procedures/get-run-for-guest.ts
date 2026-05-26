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
			"Public endpoint: caller supplies the plaintext participant token (issued by an org admin and delivered via URL fragment to the guest). Returns ONLY the guest's assigned steps, their step-scoped fields, and minimal run context. Never leaks other participants, other steps, kickoff data, or the workflow graph. Rate-limited by IP.",
	})
	.input(z.object({ token: z.string().min(32).max(200) }))
	.handler(async ({ input, context }) => {
		enforceRateLimit(context.headers, {
			key: "guest:get-run",
			limit: 60,
			windowMs: 60_000,
		});
		return await runEngineCall(() => getRunForGuest(input.token));
	});

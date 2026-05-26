import { z } from "zod";

import { enforceRateLimit } from "../../../orpc/rate-limit";
import { publicProcedure } from "../../../orpc/procedures";
import { completeStepAsGuest } from "../lib/guest";
import { runEngineCall } from "./_utils";

export const completeStepAsGuestProc = publicProcedure
	.route({
		method: "POST",
		path: "/runs/guest/complete-step",
		tags: ["Runs"],
		summary: "Complete a run step as a guest via participant token",
		description:
			"Public endpoint: caller supplies the plaintext participant token. completeRunStep enforces the assignee check (participantId match), required-field guard, stop-task guard, and the D-016 RUN_NOT_ACTIVE guard. Rate-limited by IP.",
	})
	.input(
		z.object({
			token: z.string().min(32).max(200),
			runStepId: z.string().min(1),
		}),
	)
	.handler(async ({ input, context }) => {
		enforceRateLimit(context.headers, {
			key: "guest:complete-step",
			limit: 30,
			windowMs: 60_000,
		});
		return await runEngineCall(() => completeStepAsGuest(input));
	});

import { z } from "zod";

import { enforceRateLimit } from "../../../orpc/rate-limit";
import { publicProcedure } from "../../../orpc/procedures";
import { setFieldValueAsGuest } from "../lib/guest";
import { runEngineCall } from "./_utils";

export const setFieldValueAsGuestProc = publicProcedure
	.route({
		method: "POST",
		path: "/runs/guest/field-value",
		tags: ["Runs"],
		summary: "Set a field value on a guest-accessible run step via participant token",
		description:
			"Public endpoint: caller supplies the plaintext participant token. setRunFieldValue's assignee check requires the resolved participantId to match the run_step_assignee row; non-assigned steps reject. Rate-limited by IP.",
	})
	.input(
		z.object({
			token: z.string().min(32).max(200),
			runStepId: z.string().min(1),
			fieldKey: z.string().min(1),
			value: z.unknown(),
		}),
	)
	.handler(async ({ input, context }) => {
		enforceRateLimit(context.headers, {
			key: "guest:set-field-value",
			limit: 60,
			windowMs: 60_000,
		});
		return await runEngineCall(() => setFieldValueAsGuest(input));
	});

import { streamToEventIterator } from "@orpc/client";
import { convertToModelMessages, streamText, textModel, type UIMessage } from "@virn/ai";
import z from "zod";

import { protectedProcedure } from "../../../orpc/procedures";

// Minimum-viable shape check on the inbound message array (AUTH_CONTRACT.md
// §3.1 — no `z.any()` at the procedure boundary). The AI SDK's UIMessage type
// has many shapes across versions; we validate the safety-relevant field
// (role) at runtime via z.custom and keep the inferred TypeScript shape as
// UIMessage so the AI SDK consumer types remain accurate.
//
// Rate-limiting is a separate concern; the `.max(200)` here is a defensive
// upper bound, not a rate limit.
const uiMessageSchema = z.custom<UIMessage>(
	(value) => {
		if (typeof value !== "object" || value === null) return false;
		const role = (value as { role?: unknown }).role;
		return role === "user" || role === "assistant" || role === "system";
	},
	{ message: "Each message must have role 'user' | 'assistant' | 'system'." },
);

export const streamMessage = protectedProcedure
	.route({
		method: "POST",
		path: "/ai/stream",
		tags: ["AI"],
		summary: "Stream AI response",
		description: "Stream an AI response without storing the chat",
	})
	.input(
		z.object({
			messages: z.array(uiMessageSchema).min(1).max(200),
		}),
	)
	.handler(async ({ input }) => {
		const { messages } = input;

		const response = streamText({
			model: textModel,
			messages: await convertToModelMessages(messages),
		});

		return streamToEventIterator(response.toUIMessageStream());
	});

import { ORPCError } from "@orpc/server";
import { findGuestParticipantForOrg, issueParticipantToken } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

// Returns the plaintext token ONCE — there's no way to re-fetch it later. The caller
// composes the guest URL (e.g. https://ops.virn.com/run-guest/#token=<plaintext>) and
// delivers it out-of-band (email, etc.). Storage stops at the HMAC hash; the plaintext
// is the user's responsibility from this point on.
export const issueParticipantTokenProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/runs/guest/tokens/issue",
		tags: ["Runs"],
		summary: "Issue a participant token for a guest on a run",
		description:
			"Admin/owner only. Generates a fresh 256-bit token, stores its HMAC-SHA256 hash, returns the plaintext ONCE. Default TTL: 7 days. The plaintext is never retrievable after this response — re-issue if lost.",
	})
	.input(
		z.object({
			participantId: z.string().min(1),
			expiresInDays: z.number().int().min(1).max(90).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		const guest = await findGuestParticipantForOrg({
			organizationId: context.organization.id,
			participantId: input.participantId,
		});
		if (!guest) {
			throw new ORPCError("NOT_FOUND", {
				message: "Guest participant not found in this organization.",
			});
		}
		return await issueParticipantToken({
			organizationId: context.organization.id,
			participantId: guest.id,
			expiresInDays: input.expiresInDays,
			issuedByUserId: context.user.id,
		});
	});

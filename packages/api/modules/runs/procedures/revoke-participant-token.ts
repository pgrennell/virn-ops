import { revokeParticipantToken } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const revokeParticipantTokenProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/runs/guest/tokens/revoke",
		tags: ["Runs"],
		summary: "Revoke a participant token",
		description:
			"Admin/owner only. Soft-revoke (sets revokedAt); the row is preserved for audit. Idempotent — revoking an already-revoked token returns `{ revoked: false }`.",
	})
	.input(z.object({ tokenId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		return await revokeParticipantToken({
			organizationId: context.organization.id,
			tokenId: input.tokenId,
		});
	});

// packages/api/modules/integrations/procedures/rotate-outbound-webhook-credential-secret.ts
//
// Generate a new signing secret for an existing credential. adminOrgProcedure.
// Returns the new plaintext ONCE. The consumer (PM) must update its inbound
// verifier before any further deliveries land, OR the delivery worker can
// briefly accept both during a coordinated rotation window (out of scope for
// step 3c v1 -- single-secret model in v1).

import { ORPCError } from "@orpc/server";
import {
	rotateOutboundWebhookCredentialSecret,
	writeAuditAndActivity,
} from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const rotateOutboundWebhookCredentialSecretProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/integrations/outbound-webhook-credentials/{id}/rotate-secret",
		tags: ["Integrations"],
		summary: "Rotate a credential's signing secret (admin/owner only)",
		description:
			"Generates a new HMAC signing secret, replaces the encrypted-at-rest ciphertext, returns the new plaintext ONCE. Existing webhook signatures using the old secret will fail verification at the consumer after rotation. Audit-logs 'outbound_webhook_credential.secret_rotated'.",
	})
	.input(z.object({ id: z.string().min(1) }))
	.handler(async ({ context, input }) => {
		const result = await rotateOutboundWebhookCredentialSecret({
			id: input.id,
			organizationId: context.organization.id,
		});
		if (!result) {
			throw new ORPCError("NOT_FOUND", { message: "Webhook credential not found." });
		}

		await writeAuditAndActivity({
			organizationId: context.organization.id,
			actorUserId: context.user.id,
			action: "outbound_webhook_credential.secret_rotated",
			verb: "rotated signing secret for",
			entityType: "outbound_webhook_credential",
			entityId: input.id,
			changes: {
				consumerProduct: result.credential.consumerProduct,
				signingSecretLastFour: result.credential.signingSecretLastFour,
				secretRotatedAt: result.credential.secretRotatedAt.toISOString(),
			},
		});

		return result;
	});

// packages/api/modules/integrations/procedures/soft-delete-outbound-webhook-credential.ts
//
// Soft-delete a webhook credential. adminOrgProcedure. The partial unique index
// excludes soft-deleted rows, so re-registering the same (org, consumerProduct)
// immediately after delete works without unique-violation.

import { ORPCError } from "@orpc/server";
import {
	softDeleteOutboundWebhookCredential,
	writeAuditAndActivity,
} from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const softDeleteOutboundWebhookCredentialProc = adminOrgProcedure
	.route({
		method: "DELETE",
		path: "/integrations/outbound-webhook-credentials/{id}",
		tags: ["Integrations"],
		summary: "Soft-delete a webhook credential (admin/owner only)",
		description:
			"Marks the credential as soft-deleted (deleted_at set, is_active=false). Any pending outbox events targeting this consumer will fail at delivery time and route to the dead-letter state. Audit-logs 'outbound_webhook_credential.deleted'.",
	})
	.input(z.object({ id: z.string().min(1) }))
	.handler(async ({ context, input }) => {
		const deleted = await softDeleteOutboundWebhookCredential(
			context.organization.id,
			input.id,
		);
		if (!deleted) {
			throw new ORPCError("NOT_FOUND", { message: "Webhook credential not found." });
		}

		await writeAuditAndActivity({
			organizationId: context.organization.id,
			actorUserId: context.user.id,
			action: "outbound_webhook_credential.deleted",
			verb: "deleted",
			entityType: "outbound_webhook_credential",
			entityId: input.id,
			changes: {},
		});

		return { ok: true };
	});

// packages/api/modules/integrations/procedures/create-outbound-webhook-credential.ts
//
// Register a cross-product consumer (Virn PM in v1) as a webhook target.
// adminOrgProcedure -- credentials govern outbound signing + return-URL
// allowlist for D-037 link-out flow.
//
// Returns the plaintext signing secret ONCE. The consumer (PM) stores this and
// uses it to verify HMAC signatures on every inbound webhook delivery. Lost =
// rotate.

import { ORPCError } from "@orpc/server";
import {
	createOutboundWebhookCredential,
	writeAuditAndActivity,
} from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

// HTTPS-only validator: rejects non-http(s) schemes outright. We allow http://
// for local dev (localhost / 127.0.0.1) since PM developers may run their
// inbound receiver on a non-TLS local server; production deployments register
// https:// endpoints. The delivery worker enforces the same shape at emit time.
const urlSchema = z
	.string()
	.url()
	.refine((u) => u.startsWith("http://") || u.startsWith("https://"), {
		message: "endpointUrl must be an http:// or https:// URL.",
	});

export const createOutboundWebhookCredentialProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/integrations/outbound-webhook-credentials",
		tags: ["Integrations"],
		summary: "Register a cross-product webhook consumer (admin/owner only)",
		description:
			"Creates a webhook credential for a sibling Virn product (consumerProduct='virn-pm' in v1). Generates a fresh signing secret and returns the plaintext ONCE -- the consumer is responsible for storing it. allowedReturnUrlPrefixes feed the D-037 link-out + return convention on the guest run view: a ?returnUrl= query param is honored only if it prefix-matches one of these entries.",
	})
	.input(
		z.object({
			consumerProduct: z.string().min(1).max(64),
			endpointUrl: urlSchema,
			allowedReturnUrlPrefixes: z.array(urlSchema).default([]),
		}),
	)
	.handler(async ({ context, input }) => {
		try {
			const result = await createOutboundWebhookCredential({
				organizationId: context.organization.id,
				consumerProduct: input.consumerProduct,
				endpointUrl: input.endpointUrl,
				allowedReturnUrlPrefixes: input.allowedReturnUrlPrefixes,
				createdBy: context.user.id,
			});

			await writeAuditAndActivity({
				organizationId: context.organization.id,
				actorUserId: context.user.id,
				action: "outbound_webhook_credential.created",
				verb: "registered",
				entityType: "outbound_webhook_credential",
				entityId: result.credential.id,
				changes: {
					consumerProduct: result.credential.consumerProduct,
					endpointUrl: result.credential.endpointUrl,
					allowedReturnUrlPrefixCount: result.credential.allowedReturnUrlPrefixes.length,
					signingSecretLastFour: result.credential.signingSecretLastFour,
				},
				activityData: {
					consumerProduct: result.credential.consumerProduct,
				},
			});

			return result;
		} catch (e) {
			// Partial unique index (org, consumer_product) WHERE deleted_at IS NULL
			// raises a unique violation when re-registering while a row is still live.
			if (
				e instanceof Error &&
				/uq_outbound_webhook_credential_org_consumer|duplicate key/i.test(e.message)
			) {
				throw new ORPCError("CONFLICT", {
					message: `A webhook credential for "${input.consumerProduct}" already exists in this organization. Rotate or delete it before re-registering.`,
				});
			}
			throw e;
		}
	});

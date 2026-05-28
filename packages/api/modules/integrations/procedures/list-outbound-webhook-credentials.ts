// packages/api/modules/integrations/procedures/list-outbound-webhook-credentials.ts
//
// List active credentials for the current org. adminOrgProcedure -- credentials
// are admin/owner scope (they govern outbound webhook signing).

import { listOutboundWebhookCredentialsForOrg } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const listOutboundWebhookCredentials = adminOrgProcedure
	.route({
		method: "GET",
		path: "/integrations/outbound-webhook-credentials",
		tags: ["Integrations"],
		summary: "List cross-product webhook credentials (admin/owner only)",
		description:
			"Returns the active (non-soft-deleted) outbound webhook credentials registered for this organization. Each row carries the consumer product, endpoint URL, last-four of the signing secret (for display), and the return-URL allowlist. The plaintext signing secret is never returned -- callers wanting to verify a secret must rotate.",
	})
	.input(z.object({}).optional())
	.handler(async ({ context }) => {
		return await listOutboundWebhookCredentialsForOrg(context.organization.id);
	});

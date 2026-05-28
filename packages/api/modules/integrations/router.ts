// packages/api/modules/integrations/router.ts
//
// Cross-product integration surfaces (Phase 11a step 3c). v1 ships the outbound
// webhook credential CRUD that PM uses to register itself as an Ops event
// consumer. The outbox table + delivery worker land alongside in part 3c-2.

import { createOutboundWebhookCredentialProc } from "./procedures/create-outbound-webhook-credential";
import { listOutboundWebhookCredentials } from "./procedures/list-outbound-webhook-credentials";
import { rotateOutboundWebhookCredentialSecretProc } from "./procedures/rotate-outbound-webhook-credential-secret";
import { softDeleteOutboundWebhookCredentialProc } from "./procedures/soft-delete-outbound-webhook-credential";

export const integrationsRouter = {
	outboundWebhookCredentials: {
		list: listOutboundWebhookCredentials,
		create: createOutboundWebhookCredentialProc,
		rotateSecret: rotateOutboundWebhookCredentialSecretProc,
		softDelete: softDeleteOutboundWebhookCredentialProc,
	},
};

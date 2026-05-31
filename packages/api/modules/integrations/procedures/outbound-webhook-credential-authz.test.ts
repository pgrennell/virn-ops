// Security hardening -- procedure-level auth gate for the outbound-webhook
// credential surface. All four procedures (create / list / rotate-secret /
// soft-delete) are adminOrgProcedure: they govern outbound HMAC signing secrets
// and the D-037 return-URL allowlist, so a plain member must be FORBIDDEN and an
// unauthenticated caller UNAUTHORIZED. The crypto round-trip is covered separately
// (outbound-webhook-credential-crypto.test.ts); this pins the access boundary.
// Mirrors approvals-authz.test.ts.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	// Credential procedures pull these at module load; unreached on the gate-fail paths.
	createOutboundWebhookCredential: vi.fn(),
	listOutboundWebhookCredentialsForOrg: vi.fn(),
	rotateOutboundWebhookCredentialSecret: vi.fn(),
	softDeleteOutboundWebhookCredential: vi.fn(),
	getOutboundWebhookCredentialForOrg: vi.fn(),
	updateOutboundWebhookCredential: vi.fn(),
	writeAuditAndActivity: vi.fn(),
}));

import { auth } from "@virn/auth";
import { getOrganizationMembership } from "@virn/database";

import { createOutboundWebhookCredentialProc } from "./create-outbound-webhook-credential";
import { listOutboundWebhookCredentials } from "./list-outbound-webhook-credentials";
import { rotateOutboundWebhookCredentialSecretProc } from "./rotate-outbound-webhook-credential-secret";
import { softDeleteOutboundWebhookCredentialProc } from "./soft-delete-outbound-webhook-credential";

const reqCtx = { context: { headers: new Headers() } };

function makeSession() {
	return {
		session: {
			id: "session-1",
			userId: "user-1",
			token: "tok",
			expiresAt: new Date(),
			activeOrganizationId: "org-1",
		},
		user: { id: "user-1", email: "u@example.com", name: "U", emailVerified: true },
	};
}

function makeMembership(role: "owner" | "admin" | "member" = "admin") {
	return { organization: { id: "org-1", name: "Org", slug: "org" }, role };
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
	vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
});

describe("outbound webhook credential procedures -- admin-only secret management", () => {
	const procs = [
		{
			name: "create",
			run: () =>
				call(
					createOutboundWebhookCredentialProc,
					{ consumerProduct: "virn-pm", endpointUrl: "https://pm.example.com/hook", allowedReturnUrlPrefixes: [] },
					reqCtx,
				),
		},
		{ name: "list", run: () => call(listOutboundWebhookCredentials, {}, reqCtx) },
		{ name: "rotate", run: () => call(rotateOutboundWebhookCredentialSecretProc, { id: "cred_1" }, reqCtx) },
		{ name: "soft-delete", run: () => call(softDeleteOutboundWebhookCredentialProc, { id: "cred_1" }, reqCtx) },
	];

	for (const p of procs) {
		it(`${p.name} throws FORBIDDEN for a plain member`, async () => {
			vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
			await expect(p.run()).rejects.toMatchObject({ code: "FORBIDDEN" });
		});

		it(`${p.name} throws UNAUTHORIZED with no session`, async () => {
			vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
			await expect(p.run()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		});
	}
});

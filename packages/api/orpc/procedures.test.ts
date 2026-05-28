import { call, ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
	},
}));

// Mocked so the org-middleware import chain doesn't pull in client.ts (which throws on
// import when DATABASE_URL is unset, e.g. in vitest). These tests only exercise the
// non-org procedures; protectedOrgProcedure / adminOrgProcedure are tested via the lib
// helpers they wrap (see modules/runs/lib/*.test.ts for the pattern).
vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	findActiveAgentByCredential: vi.fn(),
}));

import { auth } from "@virn/auth";
import { findActiveAgentByCredential, getOrganizationMembership } from "@virn/database";

import {
	adminProcedure,
	agentOrUserOrgProcedure,
	type DualAuthPrincipal,
	protectedProcedure,
	publicProcedure,
	requireAgentCapability,
} from "./procedures";

describe("publicProcedure", () => {
	it("is defined", () => {
		expect(publicProcedure).toBeDefined();
	});
});

describe("protectedProcedure", () => {
	it("is defined", () => {
		expect(protectedProcedure).toBeDefined();
	});

	it("throws UNAUTHORIZED when session is null", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);

		const testProcedure = protectedProcedure.handler(async () => ({
			success: true,
		}));

		await expect(
			call(testProcedure, undefined, {
				context: { headers: new Headers() },
			}),
		).rejects.toThrow(ORPCError);
		await expect(
			call(testProcedure, undefined, {
				context: { headers: new Headers() },
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("passes user and session to context when authenticated", async () => {
		const mockUser = { id: "user-1", role: "user", name: "Test User" };
		const mockSession = { id: "session-1", userId: "user-1" };
		vi.mocked(auth.api.getSession).mockResolvedValue({
			user: mockUser,
			session: mockSession,
		} as never);

		let capturedContext: unknown;
		const testProcedure = protectedProcedure.handler(async ({ context }: { context: unknown }) => {
			capturedContext = context;
			return { success: true };
		});

		await call(testProcedure, undefined, {
			context: { headers: new Headers() },
		});

		expect(capturedContext).toMatchObject({
			user: mockUser,
			session: mockSession,
		});
	});
});

describe("adminProcedure", () => {
	it("is defined", () => {
		expect(adminProcedure).toBeDefined();
	});

	it("throws FORBIDDEN when user role is not admin", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue({
			user: { id: "user-1", role: "user" },
			session: { id: "session-1" },
		} as never);

		const testProcedure = adminProcedure.handler(async () => ({
			success: true,
		}));

		await expect(
			call(testProcedure, undefined, {
				context: { headers: new Headers() },
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("allows admin users through", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue({
			user: { id: "admin-1", role: "admin" },
			session: { id: "session-1" },
		} as never);

		const testProcedure = adminProcedure.handler(async () => ({
			success: true,
		}));

		const result = await call(testProcedure, undefined, {
			context: { headers: new Headers() },
		});

		expect(result).toEqual({ success: true });
	});
});

// Phase 11a.1 -- dual-auth org procedure (S-01a action surface).
describe("agentOrUserOrgProcedure", () => {
	beforeEach(() => {
		// Clear call records across tests in this block -- several tests assert
		// `not.toHaveBeenCalled()` which would otherwise bleed across cases.
		vi.clearAllMocks();
	});

	it("is defined", () => {
		expect(agentOrUserOrgProcedure).toBeDefined();
	});

	it("resolves an agent principal from a valid Bearer credential", async () => {
		// Bearer wins over session even if both were present, but we don't set a session here.
		vi.mocked(findActiveAgentByCredential).mockResolvedValueOnce({
			id: "agent_1",
			organizationId: "org_1",
			name: "Turnover AI",
			originProduct: null,
			capabilities: new Set(),
		});

		let capturedContext: unknown;
		const testProcedure = agentOrUserOrgProcedure.handler(async ({ context }) => {
			capturedContext = context;
			return { ok: true };
		});

		const headers = new Headers({ authorization: "Bearer agent_secret_abcd" });
		await call(testProcedure, undefined, { context: { headers } });

		expect(findActiveAgentByCredential).toHaveBeenCalledWith("agent_secret_abcd");
		expect(capturedContext).toMatchObject({
			principal: {
				kind: "agent",
				agent: { id: "agent_1", organizationId: "org_1" },
			},
			organization: { id: "org_1" },
		});
		// No session lookup should be attempted when a bearer is present.
		expect(auth.api.getSession).not.toHaveBeenCalled();
	});

	it("throws UNAUTHORIZED for a Bearer that doesn't resolve to an active agent", async () => {
		vi.mocked(findActiveAgentByCredential).mockResolvedValueOnce(null);

		const testProcedure = agentOrUserOrgProcedure.handler(async () => ({ ok: true }));
		const headers = new Headers({ authorization: "Bearer agent_revoked" });

		await expect(
			call(testProcedure, undefined, { context: { headers } }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("Bearer takes precedence over an existing session cookie", async () => {
		// A stale session cookie + a valid bearer should resolve via the bearer; the
		// session lookup must NOT be consulted (else a developer hitting the action
		// surface from a browser could accidentally fall through to user-mode and bypass
		// agent attribution).
		vi.mocked(findActiveAgentByCredential).mockResolvedValueOnce({
			id: "agent_1",
			organizationId: "org_1",
			name: "Turnover AI",
			originProduct: null,
			capabilities: new Set(),
		});
		vi.mocked(auth.api.getSession).mockResolvedValue({
			user: { id: "user_1" },
			session: { activeOrganizationId: "org_other" },
		} as never);

		let capturedContext: unknown;
		const testProcedure = agentOrUserOrgProcedure.handler(async ({ context }) => {
			capturedContext = context;
			return { ok: true };
		});

		const headers = new Headers({
			authorization: "Bearer agent_secret",
			cookie: "session=tok",
		});
		await call(testProcedure, undefined, { context: { headers } });

		expect(capturedContext).toMatchObject({
			principal: { kind: "agent" },
			organization: { id: "org_1" },
		});
	});

	it("falls back to user-session path when no bearer is present", async () => {
		const mockUser = { id: "user_1", name: "Pat" };
		const mockSession = { id: "session_1", activeOrganizationId: "org_1" };
		vi.mocked(auth.api.getSession).mockResolvedValueOnce({
			user: mockUser,
			session: mockSession,
		} as never);
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce({
			organization: { id: "org_1", name: "Org", slug: "org" },
			role: "admin",
		} as never);

		let capturedContext: unknown;
		const testProcedure = agentOrUserOrgProcedure.handler(async ({ context }) => {
			capturedContext = context;
			return { ok: true };
		});

		await call(testProcedure, undefined, {
			context: { headers: new Headers() },
		});

		expect(capturedContext).toMatchObject({
			principal: {
				kind: "user",
				user: mockUser,
				membership: { role: "admin" },
			},
			organization: { id: "org_1" },
		});
	});

	it("throws UNAUTHORIZED in user-path when no session", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);

		const testProcedure = agentOrUserOrgProcedure.handler(async () => ({ ok: true }));
		await expect(
			call(testProcedure, undefined, { context: { headers: new Headers() } }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("throws FORBIDDEN in user-path when session has no active organization", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce({
			user: { id: "user_1" },
			session: { activeOrganizationId: null },
		} as never);

		const testProcedure = agentOrUserOrgProcedure.handler(async () => ({ ok: true }));
		await expect(
			call(testProcedure, undefined, { context: { headers: new Headers() } }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("throws FORBIDDEN in user-path when user is not a member of the active org", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce({
			user: { id: "user_1" },
			session: { activeOrganizationId: "org_1" },
		} as never);
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(null);

		const testProcedure = agentOrUserOrgProcedure.handler(async () => ({ ok: true }));
		await expect(
			call(testProcedure, undefined, { context: { headers: new Headers() } }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("ignores a malformed Authorization header and falls back to user-path", async () => {
		// "Basic ..." or similar -- not a Bearer; we should not consult the credential
		// resolver and should proceed to the user-session path instead.
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);

		const testProcedure = agentOrUserOrgProcedure.handler(async () => ({ ok: true }));
		const headers = new Headers({ authorization: "Basic Zm9vOmJhcg==" });

		await expect(
			call(testProcedure, undefined, { context: { headers } }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(findActiveAgentByCredential).not.toHaveBeenCalled();
	});

	// Phase 11a.3 -- originProduct + capabilities surface on principal context.
	it("surfaces agent.originProduct on the principal context (D-027 cross-product origin)", async () => {
		vi.mocked(findActiveAgentByCredential).mockResolvedValueOnce({
			id: "agent_pm",
			organizationId: "org_1",
			name: "Virn PM",
			originProduct: "virn-pm",
			capabilities: new Set(),
		});

		let capturedContext: unknown;
		const testProcedure = agentOrUserOrgProcedure.handler(async ({ context }) => {
			capturedContext = context;
			return { ok: true };
		});

		await call(testProcedure, undefined, {
			context: { headers: new Headers({ authorization: "Bearer agent_pm_secret" }) },
		});

		expect(capturedContext).toMatchObject({
			principal: {
				kind: "agent",
				agent: { id: "agent_pm", originProduct: "virn-pm" },
			},
		});
	});

	it("surfaces granted capability slugs on principal.agent.capabilities", async () => {
		vi.mocked(findActiveAgentByCredential).mockResolvedValueOnce({
			id: "agent_capable",
			organizationId: "org_1",
			name: "Turnover AI",
			originProduct: null,
			capabilities: new Set(["workflows.agent_steps", "automation.rules"]),
		});

		const capturedCaps: { value: Set<string> | null } = { value: null };
		const testProcedure = agentOrUserOrgProcedure.handler(async ({ context }) => {
			if (context.principal.kind === "agent") {
				capturedCaps.value = context.principal.agent.capabilities;
			}
			return { ok: true };
		});

		await call(testProcedure, undefined, {
			context: { headers: new Headers({ authorization: "Bearer agent_secret" }) },
		});

		expect(capturedCaps.value).toBeInstanceOf(Set);
		expect(capturedCaps.value?.has("workflows.agent_steps")).toBe(true);
		expect(capturedCaps.value?.has("automation.rules")).toBe(true);
		expect(capturedCaps.value?.has("library.public_listings")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Phase 11a step 4 -- requireAgentCapability gate. Pure-function tests; no
// middleware involved. The function shapes the FORBIDDEN response that every
// action-surface procedure relies on, so its behavior is worth nailing down
// here rather than re-testing through every procedure.
// ---------------------------------------------------------------------------

function userPrincipal(): DualAuthPrincipal {
	// requireAgentCapability only reads `.kind` for the user branch; the other
	// fields can be minimal-shape casts.
	return {
		kind: "user",
		user: { id: "user_1" },
		session: { id: "sess_1" },
		membership: { organization: { id: "org_1" }, role: "admin" },
	} as unknown as DualAuthPrincipal;
}

function agentPrincipal(capabilities: string[]): DualAuthPrincipal {
	return {
		kind: "agent",
		agent: {
			id: "agent_1",
			organizationId: "org_1",
			name: "Turnover AI",
			originProduct: null,
			capabilities: new Set(capabilities),
		},
	};
}

describe("requireAgentCapability", () => {
	it("user principal -> no-op (returns without throwing, capability key is irrelevant)", () => {
		// Empty-arg "no capability granted to anyone" case; users still pass.
		expect(() => requireAgentCapability(userPrincipal(), "action.runs.launch")).not.toThrow();
		expect(() =>
			requireAgentCapability(userPrincipal(), "action.runs.set_field_value"),
		).not.toThrow();
		expect(() =>
			requireAgentCapability(userPrincipal(), "action.runs.complete_step"),
		).not.toThrow();
	});

	it("agent principal with the capability -> no-op", () => {
		const p = agentPrincipal(["action.runs.launch", "action.runs.complete_step"]);
		expect(() => requireAgentCapability(p, "action.runs.launch")).not.toThrow();
		expect(() => requireAgentCapability(p, "action.runs.complete_step")).not.toThrow();
	});

	it("agent principal lacking the capability -> throws FORBIDDEN with the capability + agentId in data", () => {
		const p = agentPrincipal(["action.runs.complete_step"]); // missing launch
		let caught: unknown;
		try {
			requireAgentCapability(p, "action.runs.launch");
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ORPCError);
		const err = caught as ORPCError<string, unknown>;
		expect(err.code).toBe("FORBIDDEN");
		expect(err.message).toMatch(/Turnover AI/);
		expect(err.message).toMatch(/action\.runs\.launch/);
		expect(err.data).toMatchObject({
			capability: "action.runs.launch",
			agentId: "agent_1",
		});
	});

	it("agent principal with an empty capability set -> throws FORBIDDEN for every action", () => {
		const p = agentPrincipal([]);
		expect(() => requireAgentCapability(p, "action.runs.launch")).toThrow(
			/does not have the "action.runs.launch"/,
		);
		expect(() => requireAgentCapability(p, "action.runs.set_field_value")).toThrow(
			/does not have the "action.runs.set_field_value"/,
		);
		expect(() => requireAgentCapability(p, "action.runs.complete_step")).toThrow(
			/does not have the "action.runs.complete_step"/,
		);
	});

	it("granting one capability does not implicitly grant others (capability set is exact)", () => {
		const p = agentPrincipal(["action.runs.launch"]);
		expect(() => requireAgentCapability(p, "action.runs.launch")).not.toThrow();
		expect(() => requireAgentCapability(p, "action.runs.set_field_value")).toThrow(
			/FORBIDDEN|does not have/,
		);
	});
});

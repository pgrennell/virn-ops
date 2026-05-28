// packages/api/mcp/server.test.ts
//
// Phase 11b — MCP JSON-RPC envelope + dispatch + auth-forwarding tests.
//
// Strategy: mock the @virn/database + @virn/auth boundaries so the tools/call branch
// flows through the real oRPC procedures + real agentOrUserOrgProcedure middleware. The
// MCP wrapper is dumb -- the value of these tests is verifying it doesn't lose the bearer
// token, doesn't drop arguments, and correctly translates oRPC return shapes into MCP
// `content` envelopes.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@virn/database", () => ({
	// procedure middleware
	findActiveAgentByCredential: vi.fn(),
	getOrganizationMembership: vi.fn(),
	// run engine helpers (used by the procedures' lib calls in tools/call tests)
	findAgentParticipantForRun: vi.fn(),
	findFieldByVersionAndKey: vi.fn(),
	getRunForOrg: vi.fn(),
	getRunStepWithRun: vi.fn(),
	upsertRunFieldValue: vi.fn(),
	validateFieldValue: vi.fn((_field: unknown, value: unknown) => value),
	validateLookupReferenceByKey: vi.fn(),
	withTransaction: vi.fn(async (fn) => fn({} as never)),
	writeAuditAndActivity: vi.fn(),
	listAssignedTasksForAgent: vi.fn(),
	listAssignedTasksForUser: vi.fn(),
	// launch path
	getAgentForOrg: vi.fn(),
	getLatestPublishedWorkflowVersion: vi.fn(),
	getVendorContactForLaunch: vi.fn(),
	getVersionLaunchBundle: vi.fn(),
	getWorkflowForOrg: vi.fn(),
	getWorkflowVersionById: vi.fn(),
	insertRunSnapshot: vi.fn(),
	// completeStep path
	areAllRequiredRunStepsComplete: vi.fn(),
	findIncompleteStopDependencies: vi.fn(),
	getFieldValuesForRun: vi.fn(),
	getRequiredFieldsForStep: vi.fn(),
	markRunCompleted: vi.fn(),
	markRunStepCompleted: vi.fn(),
}));

import {
	findActiveAgentByCredential,
	findAgentParticipantForRun,
	findFieldByVersionAndKey,
	getRunStepWithRun,
	listAssignedTasksForAgent,
	upsertRunFieldValue,
	writeAuditAndActivity,
} from "@virn/database";

import { handleMcpRequest } from "./server";
import { tools } from "./tools";

// Phase 11a step 4 -- action-surface procedures now gate on per-agent
// capabilities. Grant the full action set so the existing tools/call tests
// continue to exercise the procedures themselves rather than the gate. The
// dedicated gate-deny tests live in orpc/procedures.test.ts.
const AGENT = {
	id: "agent_1",
	organizationId: "org_1",
	name: "Turnover AI",
	originProduct: null,
	capabilities: new Set<string>([
		"action.runs.launch",
		"action.runs.set_field_value",
		"action.runs.complete_step",
	]),
};

function bearer(token: string): Headers {
	return new Headers({ authorization: `Bearer ${token}` });
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(findActiveAgentByCredential).mockResolvedValue(AGENT);
	vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Envelope handling
// ---------------------------------------------------------------------------

describe("handleMcpRequest -- envelope", () => {
	it("rejects non-object payloads with -32600", async () => {
		const result = await handleMcpRequest("not-an-object", new Headers());
		expect(result).toMatchObject({
			jsonrpc: "2.0",
			id: null,
			error: { code: -32600 },
		});
	});

	it("rejects payloads without jsonrpc:'2.0' with -32600", async () => {
		const result = await handleMcpRequest(
			{ id: 1, method: "ping" },
			new Headers(),
		);
		expect(result).toMatchObject({
			jsonrpc: "2.0",
			id: 1,
			error: { code: -32600 },
		});
	});

	it("returns -32601 for unknown methods", async () => {
		const result = await handleMcpRequest(
			{ jsonrpc: "2.0", id: "x", method: "does-not-exist" },
			new Headers(),
		);
		expect(result).toMatchObject({
			jsonrpc: "2.0",
			id: "x",
			error: { code: -32601 },
		});
	});

	it("returns null for notifications (requests with no id)", async () => {
		const result = await handleMcpRequest(
			{ jsonrpc: "2.0", method: "ping" },
			new Headers(),
		);
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// initialize handshake + ping + tools/list
// ---------------------------------------------------------------------------

describe("handleMcpRequest -- handshake + catalog", () => {
	it("initialize returns protocolVersion, capabilities.tools, and serverInfo", async () => {
		const result = await handleMcpRequest(
			{ jsonrpc: "2.0", id: 1, method: "initialize" },
			new Headers(),
		);
		expect(result).toMatchObject({
			jsonrpc: "2.0",
			id: 1,
			result: {
				protocolVersion: expect.any(String),
				capabilities: { tools: {} },
				serverInfo: { name: expect.any(String), version: expect.any(String) },
			},
		});
	});

	it("ping returns an empty result", async () => {
		const result = await handleMcpRequest(
			{ jsonrpc: "2.0", id: 2, method: "ping" },
			new Headers(),
		);
		expect(result).toMatchObject({ jsonrpc: "2.0", id: 2, result: {} });
	});

	it("tools/list returns the catalog with name + description + inputSchema and no handler field", async () => {
		const result = await handleMcpRequest(
			{ jsonrpc: "2.0", id: 3, method: "tools/list" },
			new Headers(),
		);
		const wireTools = (result as { result: { tools: unknown[] } }).result.tools;
		expect(wireTools).toHaveLength(tools.length);
		for (const t of wireTools) {
			const tt = t as Record<string, unknown>;
			expect(tt).toHaveProperty("name");
			expect(tt).toHaveProperty("description");
			expect(tt).toHaveProperty("inputSchema");
			expect(tt).not.toHaveProperty("handler");
		}
		const names = (wireTools as Array<{ name: string }>).map((t) => t.name);
		expect(names).toEqual([
			"runs_launch",
			"runs_set_field_value",
			"runs_complete_step",
			"runs_list_my_tasks",
		]);
	});
});

// ---------------------------------------------------------------------------
// tools/call -- invalid params
// ---------------------------------------------------------------------------

describe("handleMcpRequest -- tools/call invalid params", () => {
	it("returns -32602 when params.name is missing", async () => {
		const result = await handleMcpRequest(
			{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { arguments: {} } },
			bearer("agent_secret"),
		);
		expect(result).toMatchObject({ error: { code: -32602 } });
	});

	it("returns -32602 for unknown tool names", async () => {
		const result = await handleMcpRequest(
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "nope", arguments: {} },
			},
			bearer("agent_secret"),
		);
		expect(result).toMatchObject({ error: { code: -32602 } });
	});
});

// ---------------------------------------------------------------------------
// tools/call -- runs_list_my_tasks (simplest happy path; verifies auth forwarding)
// ---------------------------------------------------------------------------

describe("handleMcpRequest -- runs_list_my_tasks (auth + bridge)", () => {
	it("forwards the Bearer credential through to agentOrUserOrgProcedure and dispatches to the agent path", async () => {
		vi.mocked(listAssignedTasksForAgent).mockResolvedValueOnce([
			{
				runStepId: "rs_1",
				stepTitle: "Inspect",
				stepDescription: null,
				status: "pending",
				dueAt: null,
				runId: "run_1",
				runTitle: "Turnover for unit 3B",
				runStatus: "active",
				workflowId: "wf_1",
				workflowTitle: "STR Turnover",
				blocked: false,
			},
		]);

		const result = await handleMcpRequest(
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "runs_list_my_tasks", arguments: {} },
			},
			bearer("agent_secret_abc1234"),
		);

		// The middleware should have been asked to resolve the bearer.
		expect(findActiveAgentByCredential).toHaveBeenCalledWith("agent_secret_abc1234");
		// The agent-path query should have been called with the resolved agentId.
		expect(listAssignedTasksForAgent).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org_1", agentId: "agent_1" }),
		);

		// MCP convention: success returns `{ content: [{ type: "text", text: <JSON> }] }`.
		const content = (result as { result: { content: Array<{ type: string; text: string }> } })
			.result.content;
		expect(content).toHaveLength(1);
		expect(content[0].type).toBe("text");
		const parsed = JSON.parse(content[0].text);
		expect(parsed).toHaveLength(1);
		expect(parsed[0].runStepId).toBe("rs_1");
	});

	it("returns -32000 + UNAUTHORIZED in data.code when the bearer is invalid", async () => {
		vi.mocked(findActiveAgentByCredential).mockResolvedValueOnce(null);

		const result = await handleMcpRequest(
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "runs_list_my_tasks", arguments: {} },
			},
			bearer("agent_revoked"),
		);
		expect(result).toMatchObject({
			error: { code: -32000, data: { code: "UNAUTHORIZED" } },
		});
	});

	it("translates snake_case args (due_before) into camelCase + Date", async () => {
		vi.mocked(listAssignedTasksForAgent).mockResolvedValueOnce([]);

		await handleMcpRequest(
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "runs_list_my_tasks",
					arguments: { status: "pending", due_before: "2026-06-01", limit: 10 },
				},
			},
			bearer("agent_secret"),
		);

		expect(listAssignedTasksForAgent).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "pending",
				dueBefore: expect.any(Date),
				limit: 10,
			}),
		);
	});
});

// ---------------------------------------------------------------------------
// tools/call -- runs_set_field_value (verifies snake_case → camelCase + agent attribution)
// ---------------------------------------------------------------------------

describe("handleMcpRequest -- runs_set_field_value (bridge)", () => {
	it("translates snake_case args to camelCase and writes field_value with agent attribution", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce({
			id: "rs_1",
			status: "pending",
			stepId: "step_1",
			title: "Inspect",
			run: {
				id: "run_1",
				organizationId: "org_1",
				status: "active",
				workflowVersionId: "ver_1",
			},
			assignees: [{ participant: { id: "part_agent_1", userId: null } }],
		} as never);
		vi.mocked(findAgentParticipantForRun).mockResolvedValueOnce({ id: "part_agent_1" });
		vi.mocked(findFieldByVersionAndKey).mockResolvedValueOnce({
			id: "field_1",
			fieldType: "text",
			config: null,
			isRequired: false,
			label: "Notes",
		} as never);
		vi.mocked(upsertRunFieldValue).mockResolvedValueOnce(undefined);

		const result = await handleMcpRequest(
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "runs_set_field_value",
					arguments: {
						run_step_id: "rs_1",
						field_key: "notes",
						value: "All clear",
					},
				},
			},
			bearer("agent_secret"),
		);

		expect(upsertRunFieldValue).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: "run_1",
				runStepId: "rs_1",
				fieldId: "field_1",
				value: "All clear",
			}),
			expect.anything(),
		);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "field_value.set",
				actorKind: "agent",
				actorParticipantId: "part_agent_1",
			}),
			expect.anything(),
		);

		// Verify the MCP envelope shape (ok response wrapping {ok:true}).
		const content = (result as { result: { content: Array<{ text: string }> } }).result.content;
		expect(JSON.parse(content[0].text)).toEqual({ ok: true });
	});

	it("translates an oRPC validation error (BAD_REQUEST) into JSON-RPC -32000 with preserved code", async () => {
		// The procedure's input schema requires `field_key: string`. Passing a number triggers
		// a Zod validation failure at the oRPC layer; we want it surfaced as a clean -32000.
		const result = await handleMcpRequest(
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "runs_set_field_value",
					arguments: { run_step_id: "rs_1", field_key: 42, value: null },
				},
			},
			bearer("agent_secret"),
		);
		expect(result).toMatchObject({
			error: { code: -32000 },
		});
	});
});

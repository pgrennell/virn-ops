// packages/api/mcp/tools.ts
//
// Phase 11b — MCP tool catalog. Each entry wraps an oRPC procedure from the action surface
// (Phase 11a) and exposes it as an MCP tool. Wrapper is intentionally thin: credential
// validation, capability resolution, audit attribution, and business logic all live in the
// oRPC procedure middleware (11a.1/11a.2/11a.3). The tool handler just bridges argument
// shapes and forwards request headers so `agentOrUserOrgProcedure` picks up the bearer
// token as if the client had called oRPC directly.

import { call } from "@orpc/server";

import { completeStepProc } from "../modules/runs/procedures/complete-step";
import { launchRunProc } from "../modules/runs/procedures/launch-run";
import { listMyTasksProc } from "../modules/runs/procedures/list-my-tasks";
import { setFieldValueProc } from "../modules/runs/procedures/set-field-value";

/**
 * MCP tool definition shape. Mirrors the MCP specification for `tools/list`:
 *   - `name`: snake_case identifier (MCP convention)
 *   - `description`: surfaced to MCP hosts as the LLM-facing tool description
 *   - `inputSchema`: JSON Schema for the tool's arguments
 *   - `handler`: bridges to the underlying oRPC procedure; `headers` carries the inbound
 *     Authorization header so the procedure's auth middleware resolves the agent caller
 */
export interface McpTool {
	name: string;
	description: string;
	inputSchema: {
		type: "object";
		properties: Record<string, unknown>;
		required?: string[];
		additionalProperties?: boolean;
	};
	handler: (args: unknown, headers: Headers) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Argument-shape sanity (kept colocated with each tool so a schema drift in the
// underlying procedure is loud at compile time -- the `call(...)` invocation type-checks
// against the procedure's Zod input).
// ---------------------------------------------------------------------------

interface LaunchArgs {
	// Phase 11a step 3(a): launchers may supply EITHER a workflow_id (Ops-
	// internal identifier) OR a workflow_slug (cross-product alias). The oRPC
	// procedure enforces exactly-one-of; we surface both fields here so MCP
	// hosts pick the right one for their context.
	workflow_id?: string;
	workflow_slug?: string;
	workflow_version_id?: string;
	kickoff_values?: Record<string, unknown>;
	role_assignments?: Array<{
		role_id: string;
		user_id?: string | null;
		guest_email?: string | null;
		guest_name?: string | null;
		vendor_id?: string | null;
		vendor_contact_id?: string | null;
	}>;
	title?: string;
	mode?: "human" | "ai_assisted" | "automated";
	agent_id?: string | null;
	// Phase 11a step 3(b): cross-product callback echo. Persisted on the run
	// and echoed back in every emitted webhook. All fields optional.
	callback?: {
		pm_service_request_id?: string;
		pm_work_order_id?: string;
		webhook_events?: string[];
	};
}

interface SetFieldValueArgs {
	run_step_id: string | null;
	run_id?: string;
	field_key: string;
	value: unknown;
}

interface CompleteStepArgs {
	run_step_id: string;
}

interface ListMyTasksArgs {
	status?: "pending" | "completed";
	due_before?: string; // ISO date (the procedure coerces)
	limit?: number;
	offset?: number;
}

function asObject<T>(v: unknown): T {
	if (v && typeof v === "object" && !Array.isArray(v)) return v as T;
	throw new Error("Tool arguments must be a JSON object.");
}

/** snake_case (MCP convention) → camelCase (oRPC input). Translation kept in the wrapper so
 * the oRPC procedure stays the source of truth for input shape; MCP-host operators see a
 * conventional surface (most MCP servers use snake_case in tool input schemas). */
export const tools: McpTool[] = [
	{
		name: "runs_launch",
		description:
			"Launch a new run from a published workflow version. Provide EXACTLY ONE of `workflow_id` (Ops-internal identifier) or `workflow_slug` (cross-product alias — used by sibling products like Virn PM that don't know Ops's per-org cuid). The launching agent is added as a participant on the new run, so subsequent set_field_value / complete_step calls by the same agent are authorized. Returns the new runId.",
		inputSchema: {
			type: "object",
			properties: {
				workflow_id: { type: "string", description: "Ops-internal workflow identifier. Mutually exclusive with workflow_slug." },
				workflow_slug: {
					type: "string",
					description: "Cross-product workflow alias (Phase 11a step 3a). Populated for pack-installed workflows. Mutually exclusive with workflow_id.",
				},
				workflow_version_id: {
					type: "string",
					description: "Optional pinned version. Defaults to the latest published version.",
				},
				kickoff_values: {
					type: "object",
					description: "Map of launch-level field key → value.",
					additionalProperties: true,
				},
				role_assignments: {
					type: "array",
					description: "Per-role participant assignments. Each entry must specify exactly one of user_id / guest_email / (vendor_id + vendor_contact_id).",
					items: {
						type: "object",
						properties: {
							role_id: { type: "string" },
							user_id: { type: ["string", "null"] },
							guest_email: { type: ["string", "null"] },
							guest_name: { type: ["string", "null"] },
							vendor_id: { type: ["string", "null"] },
							vendor_contact_id: { type: ["string", "null"] },
						},
						required: ["role_id"],
					},
				},
				title: { type: "string", description: "Optional override for the run's display title." },
				mode: {
					type: "string",
					enum: ["human", "ai_assisted", "automated"],
					description: "Launch mode (S-07 wedge). Defaults to 'human'.",
				},
				agent_id: {
					type: ["string", "null"],
					description: "Required when mode is ai_assisted/automated. The agent that handles AI/all steps for this run.",
				},
				callback: {
					type: "object",
					description: "Cross-product callback echo (Phase 11a step 3b). Persisted on the run and echoed in every emitted webhook so the consumer correlates without an extra round-trip. All fields optional.",
					properties: {
						pm_service_request_id: { type: "string" },
						pm_work_order_id: { type: "string" },
						webhook_events: {
							type: "array",
							items: { type: "string" },
							description: "Filter for which catalog events this run emits. Null/omitted = all v1 events.",
						},
					},
				},
			},
		},
		handler: async (args, headers) => {
			const a = asObject<LaunchArgs>(args);
			return await call(
				launchRunProc,
				{
					workflowId: a.workflow_id,
					workflowSlug: a.workflow_slug,
					workflowVersionId: a.workflow_version_id,
					kickoffValues: a.kickoff_values ?? {},
					roleAssignments: (a.role_assignments ?? []).map((ra) => ({
						roleId: ra.role_id,
						userId: ra.user_id ?? null,
						guestEmail: ra.guest_email ?? null,
						guestName: ra.guest_name ?? null,
						vendorId: ra.vendor_id ?? null,
						vendorContactId: ra.vendor_contact_id ?? null,
					})),
					title: a.title,
					mode: a.mode ?? "human",
					agentId: a.agent_id ?? null,
					callback: a.callback
						? {
								pmServiceRequestId: a.callback.pm_service_request_id,
								pmWorkOrderId: a.callback.pm_work_order_id,
								webhookEvents: a.callback.webhook_events,
							}
						: undefined,
				},
				{ context: { headers } },
			);
		},
	},
	{
		name: "runs_set_field_value",
		description:
			"Set a field value on a run step (or kickoff field). The agent must be assigned to the step (for step-scoped writes); admins/owners are the only callers allowed to write kickoff values after launch. Field is referenced by stable key (Invariant #5), never by id.",
		inputSchema: {
			type: "object",
			properties: {
				run_step_id: {
					type: ["string", "null"],
					description: "Run step id for step-scoped writes; null for kickoff (launch-level) field writes.",
				},
				run_id: {
					type: "string",
					description: "Run id; required when run_step_id is null (kickoff write).",
				},
				field_key: { type: "string", description: "Stable field key (Invariant #5)." },
				value: { description: "The value to write. Validated against the field's snapshotted type + config." },
			},
			required: ["run_step_id", "field_key"],
		},
		handler: async (args, headers) => {
			const a = asObject<SetFieldValueArgs>(args);
			return await call(
				setFieldValueProc,
				{
					runStepId: a.run_step_id,
					runId: a.run_id,
					fieldKey: a.field_key,
					value: a.value,
				},
				{ context: { headers } },
			);
		},
	},
	{
		name: "runs_complete_step",
		description:
			"Mark a run step complete. Refuses when required fields are unfilled or a stop-task dependency is incomplete. If every required step on the run is now complete, the run is also marked complete in the same call.",
		inputSchema: {
			type: "object",
			properties: {
				run_step_id: { type: "string", description: "Run step id to mark complete." },
			},
			required: ["run_step_id"],
		},
		handler: async (args, headers) => {
			const a = asObject<CompleteStepArgs>(args);
			return await call(
				completeStepProc,
				{ runStepId: a.run_step_id },
				{ context: { headers } },
			);
		},
	},
	{
		name: "runs_list_my_tasks",
		description:
			"List the run steps assigned to this agent. Returns step + run + workflow titles, status, due date, and a `blocked` flag (true when any stop-task dependency is incomplete).",
		inputSchema: {
			type: "object",
			properties: {
				status: { type: "string", enum: ["pending", "completed"] },
				due_before: { type: "string", description: "ISO 8601 date. Filter to tasks due before this." },
				limit: { type: "integer", minimum: 1, maximum: 200 },
				offset: { type: "integer", minimum: 0 },
			},
		},
		handler: async (args, headers) => {
			const a = asObject<ListMyTasksArgs>(args);
			return await call(
				listMyTasksProc,
				{
					status: a.status,
					dueBefore: a.due_before ? new Date(a.due_before) : undefined,
					limit: a.limit,
					offset: a.offset,
				},
				{ context: { headers } },
			);
		},
	},
];

/** Lookup by name. Returns undefined for unknown tool names. */
export function findTool(name: string): McpTool | undefined {
	return tools.find((t) => t.name === name);
}

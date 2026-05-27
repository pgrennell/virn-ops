// packages/api/mcp/server.ts
//
// Phase 11b — JSON-RPC 2.0 envelope + MCP method dispatch. The wrapper is intentionally
// minimal: the MCP spec methods we implement are the ones a tool-only server needs.
// Resource/prompt/sampling methods land later (or never -- 11b is "the ecosystem-
// compatibility cherry," not the source of truth).
//
// Implemented methods:
//   - initialize        : MCP handshake
//   - tools/list        : enumerate the catalog (tools.ts)
//   - tools/call        : invoke a tool by name with arguments; bridges to oRPC
//   - ping              : liveness check (MCP optional but trivially cheap)
//
// Auth: the bearer credential lives in the HTTP request's Authorization header. Each tool
// handler forwards that Headers object into the underlying oRPC procedure's context, so
// `agentOrUserOrgProcedure` resolves the agent principal exactly as if the client had
// called oRPC directly. The MCP wrapper does NOT reimplement auth.
//
// Errors: JSON-RPC reserved codes
//   -32700 parse error · -32600 invalid request · -32601 method not found
//   -32602 invalid params · -32603 internal error
// For tool execution errors thrown by oRPC (e.g. UNAUTHORIZED, BAD_REQUEST), we wrap them
// as JSON-RPC -32000 (server-defined error) with the oRPC code preserved in `data.code`.

import { findTool, tools } from "./tools";

const PROTOCOL_VERSION = "2025-03-26"; // MCP spec version we target
const SERVER_INFO = { name: "Virn Ops MCP", version: "1.0.0" } as const;

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: string | number | null;
	method: string;
	params?: unknown;
}

interface JsonRpcSuccess {
	jsonrpc: "2.0";
	id: string | number | null;
	result: unknown;
}

interface JsonRpcError {
	jsonrpc: "2.0";
	id: string | number | null;
	error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

function ok(id: string | number | null, result: unknown): JsonRpcSuccess {
	return { jsonrpc: "2.0", id, result };
}

function err(
	id: string | number | null,
	code: number,
	message: string,
	data?: unknown,
): JsonRpcError {
	return { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

/** Extract the message + code from an arbitrary thrown value. oRPC errors carry a `code`
 * field at the top level (UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST, etc.) -- we
 * preserve it under `error.data.code` so MCP hosts can branch on it. */
function describeError(e: unknown): { message: string; code?: string; data?: unknown } {
	if (e && typeof e === "object") {
		const obj = e as { message?: unknown; code?: unknown; data?: unknown };
		return {
			message: typeof obj.message === "string" ? obj.message : "Tool execution failed.",
			code: typeof obj.code === "string" ? obj.code : undefined,
			data: obj.data,
		};
	}
	return { message: typeof e === "string" ? e : "Tool execution failed." };
}

/**
 * Handle one MCP request. `headers` is the inbound HTTP request's headers (carries the
 * agent's `Authorization: Bearer agent_<…>` token). Returns a JSON-RPC response object
 * ready to be serialized.
 *
 * Notifications (requests without an `id`) return `null`, which the HTTP layer translates
 * to an empty body per JSON-RPC convention.
 */
export async function handleMcpRequest(
	raw: unknown,
	headers: Headers,
): Promise<JsonRpcResponse | null> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return err(null, -32600, "Invalid Request: expected a JSON-RPC object.");
	}
	const req = raw as Partial<JsonRpcRequest>;
	if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
		return err(req.id ?? null, -32600, "Invalid Request: missing jsonrpc:'2.0' or method.");
	}

	const id = req.id ?? null;
	// Notifications (no id) get processed but produce no response per JSON-RPC.
	const isNotification = req.id === undefined;

	try {
		switch (req.method) {
			case "initialize": {
				const result = {
					protocolVersion: PROTOCOL_VERSION,
					capabilities: { tools: {} },
					serverInfo: SERVER_INFO,
				};
				return isNotification ? null : ok(id, result);
			}
			case "ping": {
				return isNotification ? null : ok(id, {});
			}
			case "tools/list": {
				// MCP `tools/list` wants `{ tools: [{ name, description, inputSchema }] }`.
				// We strip the local-only `handler` field before returning.
				const wire = tools.map(({ name, description, inputSchema }) => ({
					name,
					description,
					inputSchema,
				}));
				return isNotification ? null : ok(id, { tools: wire });
			}
			case "tools/call": {
				const params = (req.params ?? {}) as { name?: unknown; arguments?: unknown };
				if (typeof params.name !== "string") {
					return err(id, -32602, "Invalid params: tools/call requires `name: string`.");
				}
				const tool = findTool(params.name);
				if (!tool) {
					return err(id, -32602, `Unknown tool: ${params.name}.`);
				}
				try {
					const result = await tool.handler(params.arguments ?? {}, headers);
					// MCP convention: tool results are returned as `{ content: [{ type, text }] }`.
					// For structured results we stringify the JSON so MCP hosts get readable text
					// AND can still parse it. Setting `isError: false` is implicit (default).
					const text = JSON.stringify(result, null, 2);
					return isNotification
						? null
						: ok(id, { content: [{ type: "text", text }] });
				} catch (e) {
					const { message, code, data } = describeError(e);
					// Tool-execution failures bubble back as JSON-RPC server errors with the
					// oRPC code preserved. MCP hosts can branch on `error.data.code`.
					return isNotification
						? null
						: err(id, -32000, message, { code, ...(data !== undefined ? { details: data } : {}) });
				}
			}
			default:
				return isNotification ? null : err(id, -32601, `Method not found: ${req.method}`);
		}
	} catch (e) {
		// Defensive: unexpected throw outside the tools/call branch.
		const { message } = describeError(e);
		return isNotification ? null : err(id, -32603, `Internal error: ${message}`);
	}
}

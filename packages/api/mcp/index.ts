// packages/api/mcp/index.ts
//
// Public surface for the Phase 11b MCP wrapper. The Hono app in packages/api/index.ts
// mounts the HTTP handler at /api/mcp; everything else here is internal.

export { handleMcpRequest } from "./server";
export { tools, findTool } from "./tools";
export type { McpTool } from "./tools";

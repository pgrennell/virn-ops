import { auth } from "@virn/auth";
import { logger } from "@virn/logs";
import { webhookHandler as paymentsWebhookHandler } from "@virn/payments";
import { getBaseUrl } from "@virn/utils";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";

import { handleMcpRequest } from "./mcp";
import { openApiHandler, rpcHandler } from "./orpc/handler";

export { router } from "./orpc/router";

export const app = new Hono()
	.basePath("/api")
	// Logger middleware
	.use(honoLogger((message, ...rest) => logger.log(message, ...rest)))
	// Cors middleware
	.use(
		cors({
			origin: getBaseUrl(process.env.NEXT_PUBLIC_SAAS_URL, 3000),
			allowHeaders: ["Content-Type", "Authorization"],
			allowMethods: ["POST", "GET", "OPTIONS"],
			exposeHeaders: ["Content-Length"],
			maxAge: 600,
			credentials: true,
		}),
	)
	// Auth handler
	.on(["POST", "GET"], "/auth/**", (c) => auth.handler(c.req.raw))
	// Payments webhook handler
	.post("/webhooks/payments", (c) => paymentsWebhookHandler(c.req.raw))
	// Health check
	.get("/health", (c) => c.text("OK"))
	// Phase 11b — MCP endpoint (JSON-RPC over POST). Bearer credential auth flows
	// through the same agentOrUserOrgProcedure middleware as oRPC; this route is just a
	// protocol translator. Notifications (requests without an id) return 204.
	.post("/mcp", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json(
				{
					jsonrpc: "2.0",
					id: null,
					error: { code: -32700, message: "Parse error: invalid JSON body." },
				},
				{ status: 400 },
			);
		}
		const result = await handleMcpRequest(body, c.req.raw.headers);
		if (result === null) {
			return c.body(null, 204);
		}
		return c.json(result);
	})
	// oRPC handlers (for RPC and OpenAPI)
	.use("*", async (c, next) => {
		const context = {
			headers: c.req.raw.headers,
		};

		const isRpc = c.req.path.includes("/rpc/");

		const handler = isRpc ? rpcHandler : openApiHandler;

		const prefix = isRpc ? "/api/rpc" : "/api";

		const { matched, response } = await handler.handle(c.req.raw, {
			prefix,
			context,
		});

		if (matched) {
			return c.newResponse(response.body, response);
		}

		await next();
	});

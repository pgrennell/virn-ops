import type { RouterClient } from "@orpc/server";

import { adminRouter } from "../modules/admin/router";
import { agentsRouter } from "../modules/agents/router";
import { aiRouter } from "../modules/ai/router";
import { configRouter } from "../modules/config/router";
import { datasetsRouter } from "../modules/datasets/router";
import { listingsRouter } from "../modules/listings/router";
import { notificationsRouter } from "../modules/notifications/router";
import { organizationsRouter } from "../modules/organizations/router";
import { packsRouter } from "../modules/packs/router";
import { paymentsRouter } from "../modules/payments/router";
import { runsRouter } from "../modules/runs/router";
import { usersRouter } from "../modules/users/router";
import { vendorsRouter } from "../modules/vendors/router";
import { workflowsRouter } from "../modules/workflows/router";
import { publicProcedure } from "./procedures";

export const router = publicProcedure.router({
	admin: adminRouter,
	agents: agentsRouter,
	organizations: organizationsRouter,
	users: usersRouter,
	payments: paymentsRouter,
	ai: aiRouter,
	notifications: notificationsRouter,
	config: configRouter,
	runs: runsRouter,
	vendors: vendorsRouter,
	listings: listingsRouter,
	packs: packsRouter,
	dataSets: datasetsRouter,
	workflows: workflowsRouter,
});

export type ApiRouterClient = RouterClient<typeof router>;

import type { RouterClient } from "@orpc/server";

import { acknowledgmentsRouter } from "../modules/acknowledgments/router";
import { adminRouter } from "../modules/admin/router";
import { agentsRouter } from "../modules/agents/router";
import { aiRouter } from "../modules/ai/router";
import { approvalsRouter } from "../modules/approvals/router";
import { auditRouter } from "../modules/audit/router";
import { configRouter } from "../modules/config/router";
import { datasetsRouter } from "../modules/datasets/router";
import { entitiesRouter } from "../modules/entities/router";
import { entitysetsRouter } from "../modules/entitysets/router";
import { integrationsRouter } from "../modules/integrations/router";
import { listingsRouter } from "../modules/listings/router";
import { notificationsRouter } from "../modules/notifications/router";
import { organizationsRouter } from "../modules/organizations/router";
import { packsRouter } from "../modules/packs/router";
import { paymentsRouter } from "../modules/payments/router";
import { playbookRunsRouter } from "../modules/playbook-runs/router";
import { playbooksRouter } from "../modules/playbooks/router";
import { runsRouter } from "../modules/runs/router";
import { suggestionsRouter } from "../modules/suggestions/router";
import { usersRouter } from "../modules/users/router";
import { vendorsRouter } from "../modules/vendors/router";
import { workflowsRouter } from "../modules/workflows/router";
import { publicProcedure } from "./procedures";

export const router = publicProcedure.router({
	acknowledgments: acknowledgmentsRouter,
	admin: adminRouter,
	agents: agentsRouter,
	approvals: approvalsRouter,
	audit: auditRouter,
	organizations: organizationsRouter,
	users: usersRouter,
	payments: paymentsRouter,
	ai: aiRouter,
	notifications: notificationsRouter,
	config: configRouter,
	runs: runsRouter,
	suggestions: suggestionsRouter,
	vendors: vendorsRouter,
	listings: listingsRouter,
	packs: packsRouter,
	dataSets: datasetsRouter,
	entities: entitiesRouter,
	entitySets: entitysetsRouter,
	integrations: integrationsRouter,
	workflows: workflowsRouter,
	playbooks: playbooksRouter,
	playbookRuns: playbookRunsRouter,
});

export type ApiRouterClient = RouterClient<typeof router>;

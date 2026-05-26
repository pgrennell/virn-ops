import { ORPCError } from "@orpc/server";
import { getVersionEditBundle, getVersionWithWorkflow } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const getVersionBundleProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/workflows/versions/{versionId}",
		tags: ["Workflows"],
		summary: "Get a workflow version with sections + steps + fields + dependencies",
		description:
			"Returns the full canvas payload in a single round-trip. Each field carries `isKeyLocked` so the UI can render the locked-key chip without a second query. Status (draft / published / archived) is on the returned `version` so the UI knows whether to enable mutations.",
	})
	.input(z.object({ versionId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		// Org scope check first so cross-tenant probes return the same NOT_FOUND as
		// "doesn't exist" -- can't enumerate other orgs' version ids.
		const pair = await getVersionWithWorkflow(input.versionId);
		if (!pair || pair.workflow.organizationId !== context.organization.id) {
			throw new ORPCError("NOT_FOUND", { message: "Workflow version not found." });
		}
		const bundle = await getVersionEditBundle(input.versionId);
		if (!bundle) {
			throw new ORPCError("NOT_FOUND", { message: "Workflow version not found." });
		}
		return { ...bundle, workflow: pair.workflow };
	});

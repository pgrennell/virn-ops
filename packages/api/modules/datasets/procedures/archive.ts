// packages/api/modules/datasets/procedures/archive.ts
//
// Archive a data set (sets status='archived'). adminOrgProcedure. Existing run
// field_values that reference records of this data set remain readable; the picker
// stops surfacing this set for new lookup-field selections.

import { ORPCError } from "@orpc/server";
import { archiveDataSet, writeAuditAndActivity } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const archive = adminOrgProcedure
	.route({
		method: "POST",
		path: "/data-sets/{id}/archive",
		tags: ["DataSets"],
		summary: "Archive a data set (admin/owner only)",
		description:
			"Sets status='archived'. Historical run field_values referencing records of this set remain readable; new picker selections won't surface it. Lookup field configs that point at the archived set's key will surface a warning in the builder. Audit-logs 'data_set.archived'.",
	})
	.input(z.object({ id: z.string().min(1) }))
	.handler(async ({ context, input }) => {
		const result = await archiveDataSet({
			organizationId: context.organization.id,
			dataSetId: input.id,
		});
		if (!result.archived) {
			throw new ORPCError("NOT_FOUND", { message: "Data set not found." });
		}

		await writeAuditAndActivity({
			organizationId: context.organization.id,
			actorUserId: context.user.id,
			action: "data_set.archived",
			verb: "archived",
			entityType: "field_definition",
			entityId: input.id,
		});

		return { archived: true };
	});

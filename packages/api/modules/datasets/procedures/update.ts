// packages/api/modules/datasets/procedures/update.ts
//
// Patch a data set's mutable fields (key, name, description, status).
// adminOrgProcedure. Renaming the key is allowed but will break any lookup field
// configs pointing at the old key -- callers should warn before allowing the rename.

import { ORPCError } from "@orpc/server";
import { updateDataSet, writeAuditAndActivity } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

const KEY_REGEX = /^[a-z][a-z0-9-]*$/;

export const update = adminOrgProcedure
	.route({
		method: "PATCH",
		path: "/data-sets/{id}",
		tags: ["DataSets"],
		summary: "Update a data set (admin/owner only)",
		description:
			"Patches key, name, description, or status. Renaming a key will break lookup field configs that reference the old key -- the UI should confirm before letting the user rename. Audit-logs 'data_set.updated'.",
	})
	.input(
		z.object({
			id: z.string().min(1),
			key: z.string().min(1).max(80).regex(KEY_REGEX).optional(),
			name: z.string().min(1).max(120).optional(),
			description: z.string().max(2000).nullish(),
			status: z.enum(["active", "inactive", "archived"]).optional(),
		}),
	)
	.handler(async ({ context, input }) => {
		const { id, ...patch } = input;
		try {
			const updated = await updateDataSet({
				organizationId: context.organization.id,
				dataSetId: id,
				key: patch.key,
				name: patch.name,
				description: patch.description ?? undefined,
				status: patch.status,
			});
			if (!updated) {
				throw new ORPCError("NOT_FOUND", { message: "Data set not found." });
			}

			await writeAuditAndActivity({
				organizationId: context.organization.id,
				actorUserId: context.user.id,
				action: "data_set.updated",
				verb: "updated",
				entityType: "field_definition",
				entityId: id,
				changes: patch,
				activityData: { dataSetName: updated.name, dataSetKey: updated.key },
			});

			return updated;
		} catch (e) {
			if (e instanceof Error && /uq_data_set_org_key|duplicate key/i.test(e.message)) {
				throw new ORPCError("CONFLICT", {
					message: `A data set with key "${input.key}" already exists in this organization.`,
				});
			}
			throw e;
		}
	});

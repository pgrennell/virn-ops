// packages/api/modules/datasets/procedures/create.ts
//
// Create an org-scoped data set. adminOrgProcedure -- data sets shape what `lookup`
// fields resolve to + may seed pack content; admins own them.
//
// Key convention: lowercase, dashes, alphanumeric. Stable identifier; the lookup field
// config stores the key, not the id. Validated against /^[a-z][a-z0-9-]*$/.

import { ORPCError } from "@orpc/server";
import { createDataSet, writeAuditAndActivity } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

const KEY_REGEX = /^[a-z][a-z0-9-]*$/;

export const create = adminOrgProcedure
	.route({
		method: "POST",
		path: "/data-sets",
		tags: ["DataSets"],
		summary: "Create a data set (admin/owner only)",
		description:
			"Creates an org-scoped data set. Records (the v1 convention is { label, value? }) are added via dataSets.createRecord after creation. Audit-logs 'data_set.created'.",
	})
	.input(
		z.object({
			key: z
				.string()
				.min(1)
				.max(80)
				.regex(KEY_REGEX, "Key must be lowercase, start with a letter, and use only letters, digits, and dashes."),
			name: z.string().min(1).max(120),
			description: z.string().max(2000).nullish(),
		}),
	)
	.handler(async ({ context, input }) => {
		try {
			const result = await createDataSet({
				organizationId: context.organization.id,
				key: input.key,
				name: input.name,
				description: input.description ?? null,
			});

			await writeAuditAndActivity({
				organizationId: context.organization.id,
				actorUserId: context.user.id,
				action: "data_set.created",
				verb: "created",
				entityType: "field_definition", // closest existing entity_type for catalog rows
				entityId: result.id,
				changes: { key: input.key, name: input.name, description: input.description ?? null },
				activityData: { dataSetName: input.name, dataSetKey: input.key },
			});

			return result;
		} catch (e) {
			if (e instanceof Error && /uq_data_set_org_key|duplicate key/i.test(e.message)) {
				throw new ORPCError("CONFLICT", {
					message: `A data set with key "${input.key}" already exists in this organization.`,
				});
			}
			throw e;
		}
	});

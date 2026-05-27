// packages/api/modules/datasets/procedures/update-record.ts
//
// Patch a record's label / value. adminOrgProcedure. The record's id stays stable --
// existing run field_values that point at this record continue to resolve.

import { ORPCError } from "@orpc/server";
import { updateDataSetRecord, writeAuditAndActivity } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const updateRecord = adminOrgProcedure
	.route({
		method: "PATCH",
		path: "/data-sets/{dataSetId}/records/{recordId}",
		tags: ["DataSets"],
		summary: "Update a data set record (admin/owner only)",
		description:
			"Patches label and/or value. Other keys in the record's values jsonb are preserved (forward-compatible with multi-field records when they ship post-v1). Audit-logs 'data_set_record.updated'.",
	})
	.input(
		z.object({
			dataSetId: z.string().min(1),
			recordId: z.string().min(1),
			label: z.string().min(1).max(200).optional(),
			value: z.unknown().optional(),
		}),
	)
	.handler(async ({ context, input }) => {
		const result = await updateDataSetRecord({
			organizationId: context.organization.id,
			dataSetId: input.dataSetId,
			recordId: input.recordId,
			label: input.label,
			value: input.value,
		});
		if (!result) {
			throw new ORPCError("NOT_FOUND", {
				message: "Data set or record not found.",
			});
		}

		await writeAuditAndActivity({
			organizationId: context.organization.id,
			actorUserId: context.user.id,
			action: "data_set_record.updated",
			verb: "updated record on",
			entityType: "field_definition",
			entityId: input.dataSetId,
			changes: { recordId: input.recordId, label: input.label },
			activityData: { recordLabel: result.label },
		});

		return result;
	});

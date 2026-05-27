// packages/api/modules/datasets/procedures/create-record.ts
//
// Add a record to a data set. adminOrgProcedure. v1 record shape per BUILD_PLAN Phase
// 9: { label: string, value?: unknown }. label is the user-visible name; value is
// optional structured data the workflow consumes later (merge vars / conditions --
// both deferred).

import { ORPCError } from "@orpc/server";
import { createDataSetRecord, writeAuditAndActivity } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const createRecord = adminOrgProcedure
	.route({
		method: "POST",
		path: "/data-sets/{dataSetId}/records",
		tags: ["DataSets"],
		summary: "Add a record to a data set (admin/owner only)",
		description:
			"Creates a record with the v1 convention { label, value? }. Multi-field records are post-v1. Audit-logs 'data_set_record.created'.",
	})
	.input(
		z.object({
			dataSetId: z.string().min(1),
			label: z.string().min(1).max(200),
			value: z.unknown().optional(),
		}),
	)
	.handler(async ({ context, input }) => {
		const result = await createDataSetRecord({
			organizationId: context.organization.id,
			dataSetId: input.dataSetId,
			label: input.label,
			value: input.value,
		});
		if (!result) {
			throw new ORPCError("NOT_FOUND", { message: "Data set not found." });
		}

		await writeAuditAndActivity({
			organizationId: context.organization.id,
			actorUserId: context.user.id,
			action: "data_set_record.created",
			verb: "added record to",
			entityType: "field_definition",
			entityId: input.dataSetId,
			changes: { recordId: result.id, label: result.label },
			activityData: { recordLabel: result.label },
		});

		return result;
	});

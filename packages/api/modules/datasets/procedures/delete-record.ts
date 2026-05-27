// packages/api/modules/datasets/procedures/delete-record.ts
//
// Soft-delete a record (sets deletedAt). adminOrgProcedure. Historical run
// field_values pointing at this record id remain readable; future picker queries
// filter the deleted row out.

import { ORPCError } from "@orpc/server";
import { deleteDataSetRecord, writeAuditAndActivity } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const deleteRecord = adminOrgProcedure
	.route({
		method: "DELETE",
		path: "/data-sets/{dataSetId}/records/{recordId}",
		tags: ["DataSets"],
		summary: "Soft-delete a record from a data set (admin/owner only)",
		description:
			"Sets deletedAt. Historical run field_values referencing this record id remain readable; future picker queries filter the deleted row out. Idempotent. Audit-logs 'data_set_record.deleted'.",
	})
	.input(
		z.object({
			dataSetId: z.string().min(1),
			recordId: z.string().min(1),
		}),
	)
	.handler(async ({ context, input }) => {
		const result = await deleteDataSetRecord({
			organizationId: context.organization.id,
			dataSetId: input.dataSetId,
			recordId: input.recordId,
		});
		if (!result.deleted) {
			throw new ORPCError("NOT_FOUND", {
				message: "Data set or record not found.",
			});
		}

		await writeAuditAndActivity({
			organizationId: context.organization.id,
			actorUserId: context.user.id,
			action: "data_set_record.deleted",
			verb: "deleted record from",
			entityType: "field_definition",
			entityId: input.dataSetId,
			changes: { recordId: input.recordId },
		});

		return { deleted: true };
	});

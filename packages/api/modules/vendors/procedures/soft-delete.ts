// packages/api/modules/vendors/procedures/soft-delete.ts
//
// Soft-delete a vendor (sets deletedAt + isActive=false). adminOrgProcedure. Historical
// `participant` rows pointing at the vendor are preserved via ON DELETE RESTRICT --
// past activity feed entries still show "Acme Pest Control (Mike) completed Step 3".
// New picker selection fails after delete. Idempotent.

import { ORPCError } from "@orpc/server";
import { softDeleteVendor, writeAuditAndActivity } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const softDelete = adminOrgProcedure
	.route({
		method: "DELETE",
		path: "/vendors/{id}",
		tags: ["Vendors"],
		summary: "Soft-delete a vendor (admin/owner only)",
		description:
			"Sets deletedAt + isActive=false. Historical participant rows are preserved (the activity feed still shows past vendor actions). New picker selection for this vendor fails after delete. Idempotent. Audit-logs 'vendor.deleted'.",
	})
	.input(
		z.object({
			id: z.string().min(1),
		}),
	)
	.handler(async ({ context, input }) => {
		const result = await softDeleteVendor({
			organizationId: context.organization.id,
			vendorId: input.id,
		});
		if (!result.deleted) {
			throw new ORPCError("NOT_FOUND", { message: "Vendor not found." });
		}

		await writeAuditAndActivity({
			organizationId: context.organization.id,
			actorUserId: context.user.id,
			action: "vendor.deleted",
			verb: "deleted",
			entityType: "vendor",
			entityId: input.id,
		});

		return { deleted: true };
	});

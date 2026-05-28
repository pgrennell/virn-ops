// packages/api/modules/vendors/procedures/update.ts
//
// Patch a vendor's mutable fields (name, description, categoryId, status, isActive).
// adminOrgProcedure. Toggling isActive=false removes the vendor from new picker
// selection (historical runs unaffected). Setting status='blacklisted' is a stronger
// signal -- the launcher should refuse selection regardless of isActive.

import { ORPCError } from "@orpc/server";
import {
	enqueueCrossProductEventForVendor,
	updateVendor,
	writeAuditAndActivity,
} from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

const VENDOR_STATUS = [
	"active",
	"preferred",
	"approved",
	"under_review",
	"probation",
	"blacklisted",
] as const;

export const update = adminOrgProcedure
	.route({
		method: "PATCH",
		path: "/vendors/{id}",
		tags: ["Vendors"],
		summary: "Update a vendor (admin/owner only)",
		description:
			"Patches name, description, categoryId, status, or isActive. Audit-logs 'vendor.updated'.",
	})
	.input(
		z.object({
			id: z.string().min(1),
			name: z.string().min(1).max(120).optional(),
			description: z.string().max(2000).nullish(),
			categoryId: z.string().min(1).nullish(),
			status: z.enum(VENDOR_STATUS).optional(),
			isActive: z.boolean().optional(),
		}),
	)
	.handler(async ({ context, input }) => {
		const { id, ...patch } = input;
		try {
			const updated = await updateVendor({
				organizationId: context.organization.id,
				vendorId: id,
				name: patch.name,
				description: patch.description ?? undefined,
				categoryId: patch.categoryId ?? undefined,
				status: patch.status,
				isActive: patch.isActive,
			});
			if (!updated) {
				throw new ORPCError("NOT_FOUND", { message: "Vendor not found." });
			}

			await writeAuditAndActivity({
				organizationId: context.organization.id,
				actorUserId: context.user.id,
				action: "vendor.updated",
				verb: "updated",
				entityType: "vendor",
				entityId: id,
				changes: patch,
				activityData: { vendorName: updated.name },
			});

			// Phase 11a step 3c part 2 -- cross-product outbox enqueue. Same
			// event type as create (vendor.upserted) -- the consumer treats both
			// as "vendor state changed, here's the current shape" rather than
			// caring whether it was a create or an update.
			await enqueueCrossProductEventForVendor({
				vendorId: id,
				eventType: "vendor.upserted",
				crossProductOrigin: null,
			});

			return updated;
		} catch (e) {
			if (e instanceof Error && /uq_vendor_org_name|duplicate key/i.test(e.message)) {
				throw new ORPCError("CONFLICT", {
					message: `A vendor named "${input.name}" already exists in this organization.`,
				});
			}
			throw e;
		}
	});

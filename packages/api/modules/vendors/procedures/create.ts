// packages/api/modules/vendors/procedures/create.ts
//
// Create an org-scoped vendor. adminOrgProcedure -- only admin/owner can manage
// vendors (they show up in the launcher's vendor picker for any future run, and the
// 'preferred' / 'blacklisted' status flags shape selection logic).

import { ORPCError } from "@orpc/server";
import {
	createVendor,
	enqueueCrossProductEventForVendor,
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

export const create = adminOrgProcedure
	.route({
		method: "POST",
		path: "/vendors",
		tags: ["Vendors"],
		summary: "Create a vendor (admin/owner only)",
		description:
			"Creates an org-scoped vendor. The vendor has no contacts yet -- contacts must be added via vendors.createContact before the vendor can be assigned to a run (ADR-007 + D-023: participant CHECK requires both vendorId and vendorContactId). Audit-logs 'vendor.created'.",
	})
	.input(
		z.object({
			name: z.string().min(1).max(120),
			description: z.string().max(2000).nullish(),
			categoryId: z.string().min(1).nullish(),
			status: z.enum(VENDOR_STATUS).optional(),
		}),
	)
	.handler(async ({ context, input }) => {
		try {
			const result = await createVendor({
				organizationId: context.organization.id,
				name: input.name,
				description: input.description ?? null,
				categoryId: input.categoryId ?? null,
				status: input.status,
				createdByUserId: context.user.id,
			});

			await writeAuditAndActivity({
				organizationId: context.organization.id,
				actorUserId: context.user.id,
				action: "vendor.created",
				verb: "created",
				entityType: "vendor",
				entityId: result.id,
				changes: {
					name: result.name,
					description: result.description,
					status: result.status,
					categoryId: result.categoryId,
				},
				activityData: { vendorName: result.name },
			});

			// Phase 11a step 3c part 2 -- cross-product outbox enqueue. Org-wide
			// fan-out: one outbox row per active consumer registered for the org.
			// No-op when no consumers exist. Non-transactional with the vendor
			// write (matches the existing audit pattern above); a future refactor
			// that wraps this whole handler in withTransaction would also thread
			// `tx` into this call.
			await enqueueCrossProductEventForVendor({
				vendorId: result.id,
				eventType: "vendor.upserted",
				crossProductOrigin: null,
			});

			return result;
		} catch (e) {
			if (e instanceof Error && /uq_vendor_org_name|duplicate key/i.test(e.message)) {
				throw new ORPCError("CONFLICT", {
					message: `A vendor named "${input.name}" already exists in this organization.`,
				});
			}
			throw e;
		}
	});

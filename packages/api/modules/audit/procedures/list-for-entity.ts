// Phase 15 -- audit_log reader for the compliance / evidence surface (S-10).
//
// Polymorphic over (entityType, entityId). Used by:
//   - the per-workflow Audit tab at /library/workflows/[id]/audit (Slice C)
//   - the per-acknowledgment evidence receipt (Slice D)
//   - any future compliance reader that needs an entity's lifecycle history
//
// Permission: adminOrgProcedure gates to admin/owner today. Once ADR-004's
// custom-role layer ships, widen to a `reviewerOrAdminOrgProcedure` that
// also accepts reviewer-grade members (the compliance pack's primary
// audience per NAV_AREAS.compliance.allowedRoles).
//
// Capability: the /compliance page already gates on the compliance.pack
// capability via assertCanSee(NAV_AREAS.compliance); the procedure intentionally
// does NOT duplicate that check. An admin in a non-compliance.pack org
// hitting this procedure directly sees data they're already authorized to
// view at the org level -- the capability flag gates feature exposure, not
// access to the underlying audit_log.

import { listAuditLogForEntity, type AuditEntityType } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

// Mirror the entityType pgEnum literal-by-literal so the procedure input rejects
// typos at the API boundary instead of at the DB layer. Adding a new entity_type
// value in _shared.ts surfaces as a missing literal here (caller-side); we
// extend this list deliberately rather than auto-expanding.
const auditEntityTypeSchema = z.enum([
	"workflow",
	"workflow_version",
	"section",
	"step",
	"field",
	"run",
	"run_step",
	"field_value",
	"suggestion",
	"automation_rule",
	"version_approval",
	"acknowledgment",
	"template_listing",
	"template_listing_version",
	"solution_pack",
	"pack_version",
	"field_definition",
	"role",
	"agent",
	"vendor",
	"vendor_contact",
	"listing",
	"outbound_webhook_credential",
	"playbook",
	"playbook_version",
	"playbook_run",
	"playbook_run_step",
]) satisfies z.ZodType<AuditEntityType>;

export const listForEntityProc = adminOrgProcedure
	.route({
		method: "GET",
		path: "/audit/list-for-entity",
		tags: ["Audit"],
		summary: "List the audit log for a specific entity (polymorphic)",
		description:
			"Returns audit_log rows scoped to (organizationId, entityType, entityId), newest first. Includes the actor's display name + email via a LEFT JOIN to user. Carries `changes` + `metadata` JSON for forensic diffs. Paged with totalCount so the compliance UI can render 'viewing N-M of total'.",
	})
	.input(
		z.object({
			entityType: auditEntityTypeSchema,
			entityId: z.string().min(1),
			limit: z.number().int().min(1).max(100).optional(),
			offset: z.number().int().min(0).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await listAuditLogForEntity({
			organizationId: context.organization.id,
			entityType: input.entityType,
			entityId: input.entityId,
			limit: input.limit,
			offset: input.offset,
		});
	});

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { updateWorkflowMeta } from "../lib/workflow";
import { workflowEngineCall } from "./_utils";

export const updateWorkflowProc = adminOrgProcedure
	.route({
		method: "PATCH",
		path: "/workflows/{workflowId}",
		tags: ["Workflows"],
		summary: "Update workflow-level metadata (title, description, type, isActive)",
		description:
			"Workflow-level fields only -- never touches a workflow_version. Per-version content edits route through the section/step/field procedures against the open draft.",
	})
	.input(
		z.object({
			workflowId: z.string().min(1),
			title: z.string().min(1).max(200).optional(),
			description: z.string().max(2000).nullable().optional(),
			type: z.enum(["procedure", "document", "policy", "form"]).optional(),
			isActive: z.boolean().optional(),
			// Phase 9.5e: workflow-level entity-set scope (D-034 / PRD §6.2). Empty array
			// means "applies to any entity" (preserves pre-v1.5 behavior). Non-empty array
			// narrows the launcher's set-intersection filter. Cap at 50 entries -- a
			// workflow scoped to more than that should probably be unscoped instead.
			entitySetIds: z.array(z.string().min(1)).max(50).optional(),
			// Phase 16 -- re-attestation cadence. Positive integer sets the
			// review interval; null clears it. The lib derives nextReviewAt
			// from this so the cron sweep has a concrete date. Cap at 3650
			// days (~10 years) to keep accidental "I'll never review this"
			// settings from silently never firing.
			reviewIntervalDays: z.number().int().min(1).max(3650).nullable().optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		await workflowEngineCall(() =>
			updateWorkflowMeta(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});

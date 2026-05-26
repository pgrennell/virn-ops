import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { createStep } from "../lib/structure";
import { workflowEngineCall } from "./_utils";

const stepTypeSchema = z.enum(["task", "approval", "heading", "one_off", "code", "ai"]);
const dueTypeSchema = z.enum(["none", "offset_from_start", "offset_from_step", "from_date_field"]);

export const createStepProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/workflows/versions/{workflowVersionId}/steps",
		tags: ["Workflows"],
		summary: "Create a step in a draft version",
	})
	.input(
		z.object({
			workflowVersionId: z.string().min(1),
			sectionId: z.string().min(1).nullable().optional(),
			assignedRoleId: z.string().min(1).nullable().optional(),
			type: stepTypeSchema.optional(),
			title: z.string().min(1).max(200),
			description: z.string().max(5000).nullable().optional(),
			position: z.number().int().min(0).optional(),
			isRequired: z.boolean().optional(),
			isStopTask: z.boolean().optional(),
			dueType: dueTypeSchema.optional(),
			dueOffsetDays: z.number().int().nullable().optional(),
			dueAnchorStepId: z.string().min(1).nullable().optional(),
			dueSourceFieldId: z.string().min(1).nullable().optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await workflowEngineCall(() =>
			createStep(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
	});

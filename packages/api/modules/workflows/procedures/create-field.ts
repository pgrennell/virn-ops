import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { createField } from "../lib/structure";
import { workflowEngineCall } from "./_utils";

const fieldTypeSchema = z.enum([
	"text",
	"textarea",
	"number",
	"date",
	"select",
	"multiselect",
	"file",
	"image",
	"signature",
	"member",
	"lookup",
]);

export const createFieldProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/workflows/versions/{workflowVersionId}/fields",
		tags: ["Workflows"],
		summary: "Create a field on a draft version (kickoff or step-scoped)",
		description:
			"Pass `stepId: null` for a kickoff field; pass a step's id for a step-scoped field. `key` is optional -- omit to auto-slug from `label`. Both shapes get uniqueness resolution within the version (suffix _2, _3, ...).",
	})
	.input(
		z.object({
			workflowVersionId: z.string().min(1),
			stepId: z.string().min(1).nullable(),
			label: z.string().min(1).max(200),
			key: z.string().min(1).max(64).optional(),
			fieldType: fieldTypeSchema,
			config: z.record(z.string(), z.unknown()).nullable().optional(),
			isRequired: z.boolean().optional(),
			position: z.number().int().min(0).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await workflowEngineCall(() =>
			createField(
				{ organizationId: context.organization.id, userId: context.user.id },
				{
					workflowVersionId: input.workflowVersionId,
					stepId: input.stepId,
					label: input.label,
					key: input.key,
					fieldType: input.fieldType,
					config: input.config ?? null,
					isRequired: input.isRequired,
					position: input.position,
				},
			),
		);
	});

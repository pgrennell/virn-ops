import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { updateFieldOp } from "../lib/structure";
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

export const updateFieldProc = adminOrgProcedure
	.route({
		method: "PATCH",
		path: "/workflows/fields/{fieldId}",
		tags: ["Workflows"],
		summary: "Update a field on a draft version",
		description:
			"Label, type, config, isRequired, position are always editable. `key` is editable ONLY when the field is unreferenced (no automation_condition.sourceFieldId, no step.dueSourceFieldId pointing at it). Once a reference exists, key rename fails with FIELD_KEY_LOCKED + a referencer list payload for the UI. Publishing freezes everything.",
	})
	.input(
		z.object({
			fieldId: z.string().min(1),
			label: z.string().min(1).max(200).optional(),
			key: z.string().min(1).max(64).optional(),
			fieldType: fieldTypeSchema.optional(),
			config: z.record(z.string(), z.unknown()).nullable().optional(),
			isRequired: z.boolean().optional(),
			position: z.number().int().min(0).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		await workflowEngineCall(() =>
			updateFieldOp(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});

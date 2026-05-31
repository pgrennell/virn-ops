// packages/api/modules/playbooks/lib/ai-authoring/schema.ts
//
// Phase 18c (PRD_PLAYBOOKS.md §6.2, §11) -- Zod contract for the structured JSON the
// Playbook AI-authoring model must emit. Mirrors workflows/lib/ai-authoring/schema.ts:
//
//   1. PARSE GUARD -- the model is told to emit JSON shaped like AuthoredPlaybookSchema;
//      we Zod-parse the response and refuse the build if it doesn't fit, so the playbook
//      primitives downstream get inputs they already know how to handle.
//   2. PALETTE GATE -- the discriminated union over `type` is the SAME closed set of six
//      playbook_step types the orchestrator (18b) can execute, each with a per-type config
//      shape. A future step type extends BOTH this union and the orchestrator in lockstep.
//
// Branching: the AI emits a FLAT step list. A branch child carries `branchLabel` plus
// `parentStepIndex` (an index into the steps array, since step ids don't exist at
// authoring time -- same index-reference trick the workflow schema uses for sectionIndex /
// dueAnchorStepIndex). The build resolves the index to a real parent_step_id in a second
// pass. assertAuthoredPlaybookReferences checks the cross-step references Zod can't see.
//
// Lives separate from the AI client + lib so tests import it without the Anthropic SDK.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Per-type config shapes (match the orchestrator's executePlaybookStep readers)
// ---------------------------------------------------------------------------

const objectRecord = z.record(z.string(), z.unknown());

export const WaitForDurationConfig = z.object({
	amount: z.number().int().positive(),
	unit: z.enum(["minutes", "hours", "days", "weeks"]),
});

export const WaitForEventConfig = z.object({
	eventName: z.string().min(1).max(120),
	timeoutDays: z.number().int().positive().nullable().optional(),
	onTimeout: z.enum(["continue", "abort"]).nullable().optional(),
});

export const LaunchWorkflowConfig = z.object({
	// Exactly-one-of workflowId/workflowSlug is enforced in the reference checker
	// (Zod can't express it cleanly across the discriminated union).
	workflowId: z.string().min(1).nullable().optional(),
	workflowSlug: z.string().min(1).nullable().optional(),
	kickoffValues: objectRecord.nullable().optional(),
	mode: z.enum(["human", "ai_assisted", "automated"]).nullable().optional(),
});

export const SendNotificationConfig = z.object({
	// Recipient resolution beyond an explicit userId is a Phase 18b follow-up; the
	// orchestrator skips (no-op) when userId is absent. The AI may still emit the
	// intent so a human can wire the recipient later.
	userId: z.string().min(1).nullable().optional(),
	type: z.string().min(1).max(64).nullable().optional(),
	link: z.string().max(2000).nullable().optional(),
	data: objectRecord.nullable().optional(),
});

export const BranchOnDataSetConfig = z.object({
	dataSetKey: z.string().min(1).nullable().optional(),
	recordLabel: z.string().min(1).nullable().optional(),
	field: z.string().min(1).nullable().optional(),
	// Dot-path into the trigger payload when dataSetKey is absent.
	source: z.string().min(1).nullable().optional(),
	branches: z.array(z.string().min(1).max(80)).min(1).max(20),
});

export const WriteToDataSetConfig = z.object({
	dataSetKey: z.string().min(1),
	label: z.string().min(1).max(200),
	value: objectRecord.nullable().optional(),
});

// ---------------------------------------------------------------------------
// Step shape (discriminated union on `type`)
// ---------------------------------------------------------------------------

// Shared branch-reference fields present on every step option. A branch child sets
// both; a top-level step leaves them null/absent.
const branchRefShape = {
	branchLabel: z.string().min(1).max(80).nullable().optional(),
	parentStepIndex: z.number().int().nonnegative().nullable().optional(),
} as const;

export const AuthoredPlaybookStepSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("wait_for_duration"), config: WaitForDurationConfig, ...branchRefShape }),
	z.object({ type: z.literal("wait_for_event"), config: WaitForEventConfig, ...branchRefShape }),
	z.object({ type: z.literal("launch_workflow"), config: LaunchWorkflowConfig, ...branchRefShape }),
	z.object({ type: z.literal("send_notification"), config: SendNotificationConfig, ...branchRefShape }),
	z.object({ type: z.literal("branch_on_data_set"), config: BranchOnDataSetConfig, ...branchRefShape }),
	z.object({ type: z.literal("write_to_data_set"), config: WriteToDataSetConfig, ...branchRefShape }),
]);
export type AuthoredPlaybookStep = z.infer<typeof AuthoredPlaybookStepSchema>;

export const AuthoredPlaybookSchema = z.object({
	name: z.string().min(1).max(120),
	description: z.string().max(2000).nullable().optional(),
	steps: z.array(AuthoredPlaybookStepSchema).min(1).max(100),
});
export type AuthoredPlaybook = z.infer<typeof AuthoredPlaybookSchema>;

// ---------------------------------------------------------------------------
// Cross-step reference checks (things Zod can't express in pure schema)
// ---------------------------------------------------------------------------

export interface AuthoredPlaybookValidationError {
	path: string;
	message: string;
}

/** Post-parse semantic checks. Returns the issue list; empty = OK. The caller throws a
 * domain error carrying these as `details.issues` so the procedure layer surfaces a
 * structured BAD_REQUEST instead of letting a malformed reference cascade into the build. */
export function assertAuthoredPlaybookReferences(
	pb: AuthoredPlaybook,
): AuthoredPlaybookValidationError[] {
	const issues: AuthoredPlaybookValidationError[] = [];

	for (const [i, step] of pb.steps.entries()) {
		// 1. launch_workflow needs exactly one target.
		if (step.type === "launch_workflow") {
			const hasId = !!step.config.workflowId;
			const hasSlug = !!step.config.workflowSlug;
			if (hasId === hasSlug) {
				issues.push({
					path: `steps[${i}].config`,
					message:
						"launch_workflow requires exactly one of workflowId or workflowSlug.",
				});
			}
		}

		const hasParent =
			step.parentStepIndex !== undefined && step.parentStepIndex !== null;
		const hasLabel =
			step.branchLabel !== undefined &&
			step.branchLabel !== null &&
			step.branchLabel.length > 0;

		// 2. branchLabel + parentStepIndex travel together -- one without the other is
		// a malformed branch child.
		if (hasParent !== hasLabel) {
			issues.push({
				path: `steps[${i}]`,
				message:
					"A branch child must set BOTH parentStepIndex and branchLabel (or neither).",
			});
			continue;
		}
		if (!hasParent) continue;

		// 3. parentStepIndex must point at an EARLIER branch_on_data_set step, and the
		// child's branchLabel must be one of that parent's declared branches.
		const pIdx = step.parentStepIndex as number;
		if (pIdx >= pb.steps.length) {
			issues.push({
				path: `steps[${i}].parentStepIndex`,
				message: `parentStepIndex ${pIdx} is out of range (playbook has ${pb.steps.length} step(s)).`,
			});
			continue;
		}
		if (pIdx >= i) {
			issues.push({
				path: `steps[${i}].parentStepIndex`,
				message: `parentStepIndex ${pIdx} must refer to an EARLIER step (the branch parent precedes its children).`,
			});
			continue;
		}
		const parent = pb.steps[pIdx];
		if (parent.type !== "branch_on_data_set") {
			issues.push({
				path: `steps[${i}].parentStepIndex`,
				message: `parentStepIndex ${pIdx} must point at a 'branch_on_data_set' step, not '${parent.type}'.`,
			});
			continue;
		}
		const label = step.branchLabel as string;
		if (!parent.config.branches.includes(label)) {
			issues.push({
				path: `steps[${i}].branchLabel`,
				message: `branchLabel "${label}" is not one of the parent branch's labels (${parent.config.branches.join(", ")}).`,
			});
		}
	}

	return issues;
}

// apps/saas/modules/builder/lib/capability-gates.ts
//
// Capability-shaped palette gates for the Workflow Builder (UX_SPEC §4.3 + §2).
// Wraps `isEnabled(capability, snapshot)` from the gating helper with named flags
// per palette affordance, so the form components don't have to know capability key
// strings -- they read `gates.approvalStepType` etc. directly. If a future capability
// rename happens, this is the only place that has to change.
//
// Per-affordance capability mapping (confirmed against UX_SPEC §4.3):
//   - approval step type        -> governance.approvals
//   - AI step type              -> workflows.agent_steps  (lifted from reserved, Phase 8 step 4)
//   - conditions (show-when)    -> automation.rules
//   - stop-tasks (Blocked-by)   -> automation.rules
//   - guest assignees           -> workflows.guest_participants
//   - advanced field types      -> fields.custom_definitions
//       (file / image / signature / member / lookup)
//
// Reads the snapshot off the BuilderView prop (threaded from the server-rendered
// page via assertCanSee). When a capability is OFF, the corresponding picker option
// renders with a "(needs <capability>)" hint and is disabled; the palette never just
// hides options silently (per UX_SPEC, hidden settings are settings whose gating
// capability is off -- but the BUILDER palette wants discovery: "you could turn this
// on in Configuration").

import { CAPABILITIES } from "@shared/lib/nav";
import { isEnabled, type GatingSnapshot } from "@shared/lib/gating";

import type { FieldType, StepType } from "@runs/types";

export interface PaletteGates {
	approvalStepType: boolean;
	aiStepType: boolean;
	conditionEditor: boolean;
	stopTaskEditor: boolean;
	guestAssignees: boolean;
	advancedFieldTypes: boolean;
}

export function computePaletteGates(snapshot: GatingSnapshot): PaletteGates {
	return {
		approvalStepType: isEnabled(CAPABILITIES.governanceApprovals, snapshot),
		aiStepType: isEnabled(CAPABILITIES.agentSteps, snapshot),
		conditionEditor: isEnabled(CAPABILITIES.automationRules, snapshot),
		stopTaskEditor: isEnabled(CAPABILITIES.automationRules, snapshot),
		guestAssignees: isEnabled(CAPABILITIES.guestParticipants, snapshot),
		advancedFieldTypes: isEnabled(CAPABILITIES.fieldsCustomDefinitions, snapshot),
	};
}

// ---------------------------------------------------------------------------
// Step-type palette
// ---------------------------------------------------------------------------

export interface StepTypeOption {
	value: StepType;
	label: string;
	description: string;
	/** True when the org's capability set permits this type today; false ones render
	 * disabled with a "needs X" hint. `code` stays always-reserved (no script-execution
	 * yet); `ai` now gates on workflows.agent_steps (Phase 8 step 4 lift). */
	enabled: boolean;
	disabledReason?: string;
}

export function getStepTypeOptions(gates: PaletteGates): StepTypeOption[] {
	return [
		{
			value: "task",
			label: "Task",
			description: "Standard checklist step.",
			enabled: true,
		},
		{
			value: "approval",
			label: "Approval",
			description: "Requires a Yes/No decision from the assignee.",
			enabled: gates.approvalStepType,
			disabledReason: gates.approvalStepType
				? undefined
				: "Needs the Governance — Approvals capability. Turn it on in Settings → Configuration.",
		},
		{
			value: "ai",
			label: "AI",
			description:
				"Handled by an agent at run time. Assignment is the agent picked at launch (Mode-aware launch — Phase 8 step 3).",
			enabled: gates.aiStepType,
			disabledReason: gates.aiStepType
				? undefined
				: "Needs the AI Agent Steps capability. Turn it on in Settings → Configuration.",
		},
		{
			value: "heading",
			label: "Heading",
			description: "A section label; not actionable.",
			enabled: true,
		},
		{
			value: "one_off",
			label: "One-off",
			description: "Optional ad-hoc step the operator may add at run time.",
			enabled: true,
		},
		{
			value: "code",
			label: "Code",
			description: "Reserved — coming soon.",
			enabled: false,
			disabledReason: "Reserved step type — coming with the script-execution capability.",
		},
	];
}

// ---------------------------------------------------------------------------
// Field-type palette
// ---------------------------------------------------------------------------

export interface FieldTypeOption {
	value: FieldType;
	label: string;
	advanced: boolean;
	enabled: boolean;
	disabledReason?: string;
}

/** Five "advanced" field types live behind fields.custom_definitions (UX_SPEC §4.3 +
 * the "Defer" list in the original brief). Today they're all disabled when the
 * capability is off; when ON they show but are noted as DEFERRED per the brief
 * (the storage pipeline + member directory + data sets aren't shipped). When those
 * land, drop the deferred note. */
export function getFieldTypeOptions(gates: PaletteGates): FieldTypeOption[] {
	const advancedReason = gates.advancedFieldTypes
		? "Reserved — upload pipeline / member directory / data-sets coming soon."
		: "Needs the Custom Fields capability. Turn it on in Settings → Configuration.";
	const advanced: Array<{ value: FieldType; label: string }> = [
		{ value: "file", label: "File upload" },
		{ value: "image", label: "Image upload" },
		{ value: "signature", label: "Signature" },
		{ value: "member", label: "Member" },
		{ value: "lookup", label: "Lookup" },
	];
	return [
		{ value: "text", label: "Short text", advanced: false, enabled: true },
		{ value: "textarea", label: "Long text", advanced: false, enabled: true },
		{ value: "number", label: "Number", advanced: false, enabled: true },
		{ value: "date", label: "Date", advanced: false, enabled: true },
		{ value: "select", label: "Single-select", advanced: false, enabled: true },
		{ value: "multiselect", label: "Multi-select", advanced: false, enabled: true },
		...advanced.map((opt) => ({
			value: opt.value,
			label: opt.label,
			advanced: true,
			// Currently disabled regardless: capability gates the option's existence,
			// but the storage pipeline + member directory + data sets aren't built yet
			// so even with the cap on, these are deferred. Carries a noted "coming soon"
			// reason either way.
			enabled: false,
			disabledReason: advancedReason,
		})),
	];
}

// ---------------------------------------------------------------------------
// Due-type palette
// ---------------------------------------------------------------------------

export type DueType = "none" | "offset_from_start" | "offset_from_step" | "from_date_field";

export interface DueTypeOption {
	value: DueType;
	label: string;
	description: string;
	enabled: boolean;
	disabledReason?: string;
}

/** launchRun.computeStepDueAt (packages/api/modules/runs/lib/launch-run.ts) only
 * resolves `none` + `offset_from_start` today; the other two produce a null dueAt.
 * Surfacing them as live options would let the user configure a due rule that
 * silently no-ops -- worse than not offering. Memory:
 * project_due_type_ui_constraint.md. When launchRun's resolver is extended, flip
 * `enabled: true` on the two below. */
export function getDueTypeOptions(): DueTypeOption[] {
	return [
		{
			value: "none",
			label: "No due date",
			description: "Step never has an automatic due date.",
			enabled: true,
		},
		{
			value: "offset_from_start",
			label: "Days after the run starts",
			description: "Due N days after the run is launched.",
			enabled: true,
		},
		{
			value: "offset_from_step",
			label: "Days after another step completes",
			description: "Reserved — coming soon.",
			enabled: false,
			disabledReason:
				"Reserved — the run engine doesn't resolve this yet. Configuring it now would silently no-op.",
		},
		{
			value: "from_date_field",
			label: "From a date field's value",
			description: "Reserved — coming soon.",
			enabled: false,
			disabledReason:
				"Reserved — the run engine doesn't resolve this yet. Configuring it now would silently no-op.",
		},
	];
}

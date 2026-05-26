// packages/api/modules/workflows/lib/guards.ts
//
// Single chokepoint for Invariant #3 enforcement: every section/step/field/dependency
// write must first resolve the parent workflow_version, prove it belongs to the calling
// org, and prove its status is "draft". A published or archived version is physically
// immutable through this API surface -- there is no per-procedure draft check, every
// write routes through this guard, so the rule is impossible to forget.
//
// Each guard returns the freshly-loaded (workflow + version) pair so callers don't
// re-fetch.

import {
	getSectionWithVersion,
	getStepWithVersion,
	getFieldWithVersion,
	getVersionWithWorkflow,
	getWorkflowForOrg,
} from "@virn/database";

import { WorkflowEngineError } from "./errors";

export interface DraftContext {
	organizationId: string;
}

export async function assertWorkflowInOrg(ctx: DraftContext, workflowId: string) {
	const wf = await getWorkflowForOrg(ctx.organizationId, workflowId);
	if (!wf) {
		throw new WorkflowEngineError("WORKFLOW_NOT_FOUND", "Workflow not found in this organization.", {
			workflowId,
		});
	}
	if (wf.deletedAt !== null) {
		throw new WorkflowEngineError(
			"WORKFLOW_ARCHIVED",
			"Workflow is archived. Restore it before editing.",
			{ workflowId },
		);
	}
	return wf;
}

export async function assertVersionInOrg(ctx: DraftContext, versionId: string) {
	const result = await getVersionWithWorkflow(versionId);
	if (!result) {
		throw new WorkflowEngineError("VERSION_NOT_FOUND", "Workflow version not found.", {
			versionId,
		});
	}
	if (result.workflow.organizationId !== ctx.organizationId) {
		// Cross-tenant attempt -- same error code as not-found so a probe can't enumerate
		// other orgs' workflow_version ids.
		throw new WorkflowEngineError("VERSION_NOT_FOUND", "Workflow version not found.", {
			versionId,
		});
	}
	return result;
}

/** The load-bearing chokepoint. Resolves the version (org-scoped) and refuses every
 * status that isn't "draft". Use BEFORE every write to section/step/field/dep. */
export async function assertVersionIsDraft(ctx: DraftContext, versionId: string) {
	const result = await assertVersionInOrg(ctx, versionId);
	if (result.version.status !== "draft") {
		throw new WorkflowEngineError(
			"VERSION_NOT_DRAFT",
			`Cannot edit a ${result.version.status} version. Edit a draft, or fork from this published version first.`,
			{ versionId, status: result.version.status, workflowId: result.workflow.id },
		);
	}
	return result;
}

/** Resolve a section -> its draft-only version. Use before section update/delete. */
export async function assertSectionEditable(ctx: DraftContext, sectionId: string) {
	const result = await getSectionWithVersion(sectionId);
	if (!result) {
		throw new WorkflowEngineError("SECTION_NOT_FOUND", "Section not found.", { sectionId });
	}
	// Resolve org via the version's workflow.
	const wfPair = await getVersionWithWorkflow(result.version.id);
	if (!wfPair || wfPair.workflow.organizationId !== ctx.organizationId) {
		throw new WorkflowEngineError("SECTION_NOT_FOUND", "Section not found.", { sectionId });
	}
	if (result.version.status !== "draft") {
		throw new WorkflowEngineError("VERSION_NOT_DRAFT", "Section belongs to a non-draft version.", {
			sectionId,
			versionId: result.version.id,
			status: result.version.status,
		});
	}
	return { section: result.section, version: result.version, workflow: wfPair.workflow };
}

/** Resolve a step -> its draft-only version. */
export async function assertStepEditable(ctx: DraftContext, stepId: string) {
	const result = await getStepWithVersion(stepId);
	if (!result) {
		throw new WorkflowEngineError("STEP_NOT_FOUND", "Step not found.", { stepId });
	}
	const wfPair = await getVersionWithWorkflow(result.version.id);
	if (!wfPair || wfPair.workflow.organizationId !== ctx.organizationId) {
		throw new WorkflowEngineError("STEP_NOT_FOUND", "Step not found.", { stepId });
	}
	if (result.version.status !== "draft") {
		throw new WorkflowEngineError("VERSION_NOT_DRAFT", "Step belongs to a non-draft version.", {
			stepId,
			versionId: result.version.id,
			status: result.version.status,
		});
	}
	return { step: result.step, version: result.version, workflow: wfPair.workflow };
}

/** Resolve a field -> its draft-only version. */
export async function assertFieldEditable(ctx: DraftContext, fieldId: string) {
	const result = await getFieldWithVersion(fieldId);
	if (!result) {
		throw new WorkflowEngineError("FIELD_NOT_FOUND", "Field not found.", { fieldId });
	}
	const wfPair = await getVersionWithWorkflow(result.version.id);
	if (!wfPair || wfPair.workflow.organizationId !== ctx.organizationId) {
		throw new WorkflowEngineError("FIELD_NOT_FOUND", "Field not found.", { fieldId });
	}
	if (result.version.status !== "draft") {
		throw new WorkflowEngineError("VERSION_NOT_DRAFT", "Field belongs to a non-draft version.", {
			fieldId,
			versionId: result.version.id,
			status: result.version.status,
		});
	}
	return { field: result.field, version: result.version, workflow: wfPair.workflow };
}

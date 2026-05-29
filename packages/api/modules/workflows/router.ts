// packages/api/modules/workflows/router.ts
//
// The Workflow Builder backend (UX_SPEC §4.3). Definition surface: authoring +
// versioning + publish. The run engine consumes published versions via launchRun
// (which still imports the read helpers from @virn/database -- they were lifted to
// queries/workflows.ts, same import path).
//
// Authorization shape:
//   - All writes -> adminOrgProcedure
//   - All reads  -> protectedOrgProcedure
//   - Org from session context (never input)
//   - No z.any() (every input has an explicit Zod schema)
//
// Plain-object router style matches the rest of the modules.

import { addStepDependencyProc } from "./procedures/add-step-dependency";
import { approveReviewProc } from "./procedures/approve-review";
import { archiveWorkflowProc } from "./procedures/archive-workflow";
import { createFieldProc } from "./procedures/create-field";
import { createSectionProc } from "./procedures/create-section";
import { createStepProc } from "./procedures/create-step";
import { createWorkflowProc } from "./procedures/create-workflow";
import { createWorkflowRoleProc } from "./procedures/create-workflow-role";
import { deleteFieldProc } from "./procedures/delete-field";
import { deleteSectionProc } from "./procedures/delete-section";
import { deleteStepProc } from "./procedures/delete-step";
import { deleteWorkflowRoleProc } from "./procedures/delete-workflow-role";
import { discardDraftProc } from "./procedures/discard-draft";
import { editPublishedProc } from "./procedures/edit-published";
import { getMyReadStatusProc } from "./procedures/get-my-read-status";
import { getVersionBundleProc } from "./procedures/get-version-bundle";
import { getWorkflowProc } from "./procedures/get-workflow";
import { listForEntityProc } from "./procedures/list-for-entity";
import { listForReviewProc } from "./procedures/list-for-review";
import { listReadReceiptsProc } from "./procedures/list-read-receipts";
import { listWorkflowRolesProc } from "./procedures/list-workflow-roles";
import { listWorkflowsProc } from "./procedures/list-workflows";
import { markAsReadProc } from "./procedures/mark-as-read";
import { publishVersionProc } from "./procedures/publish-version";
import { removeStepDependencyProc } from "./procedures/remove-step-dependency";
import { reorderStepsProc } from "./procedures/reorder-steps";
import { sendBackToDraftProc } from "./procedures/send-back-to-draft";
import { submitForReviewProc } from "./procedures/submit-for-review";
import { updateFieldProc } from "./procedures/update-field";
import { updateSectionProc } from "./procedures/update-section";
import { updateStepProc } from "./procedures/update-step";
import { updateWorkflowProc } from "./procedures/update-workflow";
import { updateWorkflowRoleProc } from "./procedures/update-workflow-role";

export const workflowsRouter = {
	// Workflow CRUD
	list: listWorkflowsProc,
	listForEntity: listForEntityProc, // Phase 9.5e -- entity-context launcher filter
	get: getWorkflowProc,
	create: createWorkflowProc,
	update: updateWorkflowProc,
	archive: archiveWorkflowProc,

	// Version operations
	getVersionBundle: getVersionBundleProc,
	publishVersion: publishVersionProc,
	editPublished: editPublishedProc,
	discardDraft: discardDraftProc,

	// Phase 9.5g -- concierge review (PRD §6.6)
	submitForReview: submitForReviewProc,
	approveReview: approveReviewProc,
	sendBackToDraft: sendBackToDraftProc,
	listForReview: listForReviewProc,

	// Section CRUD (draft-only)
	createSection: createSectionProc,
	updateSection: updateSectionProc,
	deleteSection: deleteSectionProc,

	// Step CRUD (draft-only)
	createStep: createStepProc,
	updateStep: updateStepProc,
	deleteStep: deleteStepProc,
	reorderSteps: reorderStepsProc,

	// Field CRUD (draft-only; key lifecycle enforced)
	createField: createFieldProc,
	updateField: updateFieldProc,
	deleteField: deleteFieldProc,

	// Step dependencies (draft-only)
	addStepDependency: addStepDependencyProc,
	removeStepDependency: removeStepDependencyProc,

	// Workflow roles (org-level)
	listRoles: listWorkflowRolesProc,
	createRole: createWorkflowRoleProc,
	updateRole: updateWorkflowRoleProc,
	deleteRole: deleteWorkflowRoleProc,

	// Phase 10 / v1.5c -- read receipts (PRD §6.4)
	markAsRead: markAsReadProc,
	getMyReadStatus: getMyReadStatusProc,
	listReadReceipts: listReadReceiptsProc,
};

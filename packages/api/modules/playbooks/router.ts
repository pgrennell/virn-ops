// packages/api/modules/playbooks/router.ts
//
// Phase 18a -- Playbooks authoring oRPC router. Mirrors workflows router shape.
//
// Scope:
//   - Playbook CRUD (list / get / create / update / setActive / archive)
//   - Step CRUD on the open draft (create / update / delete / reorder)
//   - Publish dance (publishVersion / editPublished / discardDraft)
//
// Deliberately deferred (next sessions):
//   - submitForReview + approveReview + sendBackToDraft (review-state machine).
//   - playbookRuns reads (list, get) -- Phase 18b once execution lights up.
//   - dryRender (needs a wait-step simulator).
//   - launchManual (depends on Phase 18b Inngest dispatcher).
//   - AI authoring (agents.authorPlaybook / regeneratePlaybookStep) -- Phase 18c.
//
// Authorization shape (mirrors workflows):
//   - All writes  -> adminOrgProcedure
//   - All reads   -> protectedOrgProcedure
//   - Org from session context (never input)
//   - No z.any() (every input has an explicit Zod schema)

import { archivePlaybookProc } from "./procedures/archive-playbook";
import { createPlaybookProc } from "./procedures/create-playbook";
import { createPlaybookStepProc } from "./procedures/create-step";
import { deletePlaybookStepProc } from "./procedures/delete-step";
import { discardPlaybookDraftProc } from "./procedures/discard-draft";
import { editPublishedPlaybookProc } from "./procedures/edit-published";
import { getPlaybookProc } from "./procedures/get-playbook";
import { listPlaybooksProc } from "./procedures/list-playbooks";
import { publishPlaybookVersionProc } from "./procedures/publish-version";
import { reorderPlaybookStepsProc } from "./procedures/reorder-steps";
import { setPlaybookActiveProc } from "./procedures/set-playbook-active";
import { updatePlaybookProc } from "./procedures/update-playbook";
import { updatePlaybookStepProc } from "./procedures/update-step";

export const playbooksRouter = {
	// Playbook CRUD
	list: listPlaybooksProc,
	get: getPlaybookProc,
	create: createPlaybookProc,
	update: updatePlaybookProc,
	setActive: setPlaybookActiveProc,
	archive: archivePlaybookProc,

	// Step CRUD (draft-only -- mutations refuse on published versions per D-018)
	createStep: createPlaybookStepProc,
	updateStep: updatePlaybookStepProc,
	deleteStep: deletePlaybookStepProc,
	reorderSteps: reorderPlaybookStepsProc,

	// Phase 18a -- publish dance
	publishVersion: publishPlaybookVersionProc,
	editPublished: editPublishedPlaybookProc,
	discardDraft: discardPlaybookDraftProc,
};

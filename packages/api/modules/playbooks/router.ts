// packages/api/modules/playbooks/router.ts
//
// Phase 18a (server-side core) -- Playbooks authoring oRPC router. Mirrors workflows
// router shape. Scope of this v1 surface: playbook CRUD (list / get / create /
// update / setActive / archive) + draft-version step CRUD (create / update / delete
// / reorder). Total: 10 procedures.
//
// Deliberately deferred (separate session):
//   - publishVersion + editPublished + discardDraft (snapshot dance, deep-copy with
//     parent_step_id remapping, "one open draft" enforcement -- mirrors workflows
//     publish.ts which is 489 lines).
//   - submitForReview + approveReview + sendBackToDraft (review-state machine with
//     audit/activity dance).
//   - playbookRuns reads (list, get) -- pending Phase 18b Inngest dispatcher work
//     since no runs exist until execution lights up.
//   - dryRender (needs a wait-step simulator).
//   - launchManual (depends on Phase 18b Inngest pipeline).
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
import { getPlaybookProc } from "./procedures/get-playbook";
import { listPlaybooksProc } from "./procedures/list-playbooks";
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
};

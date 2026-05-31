import { authorPlaybookProc } from "./procedures/author-playbook";
import { authorWorkflowProc } from "./procedures/author-workflow";
import { create } from "./procedures/create";
import { get } from "./procedures/get";
import { getAuthoringPromptProc } from "./procedures/get-authoring-prompt";
import { list } from "./procedures/list";
import { regeneratePlaybookStepProc } from "./procedures/regenerate-playbook-step";
import { regenerateStepProc } from "./procedures/regenerate-step";
import { rotateCredential } from "./procedures/rotate-credential";
import { softDelete } from "./procedures/soft-delete";
import { update } from "./procedures/update";

export const agentsRouter = {
	list,
	get,
	create,
	update,
	rotateCredential,
	softDelete,
	authorWorkflow: authorWorkflowProc,
	authorPlaybook: authorPlaybookProc,
	regenerateStep: regenerateStepProc,
	regeneratePlaybookStep: regeneratePlaybookStepProc,
	// Phase 12 follow-up (PRD §8.4) -- read-side surface for the
	// ai_authoring_prompt provenance row. Powers the "View originating
	// prompt" dialog on the Builder + Read view AI chips.
	getAuthoringPrompt: getAuthoringPromptProc,
};

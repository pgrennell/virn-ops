import { authorWorkflowProc } from "./procedures/author-workflow";
import { create } from "./procedures/create";
import { get } from "./procedures/get";
import { list } from "./procedures/list";
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
	regenerateStep: regenerateStepProc,
};

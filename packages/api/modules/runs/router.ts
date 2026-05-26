import { completeStepProc } from "./procedures/complete-step";
import { getHomeSummaryProc } from "./procedures/get-home-summary";
import { getRunProc } from "./procedures/get-run";
import { launchRunProc } from "./procedures/launch-run";
import { listActiveRunsProc } from "./procedures/list-active-runs";
import { listMyTasksProc } from "./procedures/list-my-tasks";
import { setFieldValueProc } from "./procedures/set-field-value";

// Plain-object router (matches the prevalent style across modules); each
// procedure already declares its own base for org-scoping / admin gates.
export const runsRouter = {
	launch: launchRunProc,
	get: getRunProc,
	setFieldValue: setFieldValueProc,
	completeStep: completeStepProc,
	listMyTasks: listMyTasksProc,
	listActiveRuns: listActiveRunsProc,
	getHomeSummary: getHomeSummaryProc,
};

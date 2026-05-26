import { publicProcedure } from "../../orpc/procedures";

import { completeStepProc } from "./procedures/complete-step";
import { getHomeSummaryProc } from "./procedures/get-home-summary";
import { getRunProc } from "./procedures/get-run";
import { launchRunProc } from "./procedures/launch-run";
import { listMyTasksProc } from "./procedures/list-my-tasks";
import { setFieldValueProc } from "./procedures/set-field-value";

export const runsRouter = publicProcedure.router({
	launch: launchRunProc,
	get: getRunProc,
	setFieldValue: setFieldValueProc,
	completeStep: completeStepProc,
	listMyTasks: listMyTasksProc,
	getHomeSummary: getHomeSummaryProc,
});

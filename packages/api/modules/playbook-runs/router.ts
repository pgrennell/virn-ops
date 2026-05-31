// Phase 18a -- playbookRuns router (read-only list + get). Phase 18b adds
// launchManual + cancel; the Inngest orchestrator populates the table.

import { cancelPlaybookRunProc } from "./procedures/cancel";
import { getPlaybookRunProc } from "./procedures/get-run";
import { launchPlaybookManualProc } from "./procedures/launch-manual";
import { listPlaybookRunsProc } from "./procedures/list-runs";

export const playbookRunsRouter = {
	list: listPlaybookRunsProc,
	get: getPlaybookRunProc,
	launchManual: launchPlaybookManualProc,
	cancel: cancelPlaybookRunProc,
};

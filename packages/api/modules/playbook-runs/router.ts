// Phase 18a -- playbookRuns router. Read-only surface for now (list + get).
// Phase 18b adds launchManual + cancel + the Inngest orchestrator that
// populates the table.

import { getPlaybookRunProc } from "./procedures/get-run";
import { listPlaybookRunsProc } from "./procedures/list-runs";

export const playbookRunsRouter = {
	list: listPlaybookRunsProc,
	get: getPlaybookRunProc,
};

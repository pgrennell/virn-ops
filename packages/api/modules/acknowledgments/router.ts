// Phase 15 -- acknowledgments module router. Read-only in this phase
// (compliance evidence reader). Phase 16 adds the acknowledge action surface
// (the WRITE path) alongside the read procedures.

import { getAcknowledgmentProc } from "./procedures/get-acknowledgment";
import { listAcknowledgmentsProc } from "./procedures/list-acknowledgments";

export const acknowledgmentsRouter = {
	list: listAcknowledgmentsProc,
	get: getAcknowledgmentProc,
};

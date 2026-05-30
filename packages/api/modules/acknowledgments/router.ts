// Phase 15 shipped the read surface (list + get); Phase 16 adds the WRITE
// path (acknowledge) + the read-shaped "have I acknowledged?" status check
// that drives the Read view's button state.

import { acknowledgeProc } from "./procedures/acknowledge";
import { getAcknowledgmentProc } from "./procedures/get-acknowledgment";
import { getMyStatusProc } from "./procedures/get-my-status";
import { listAcknowledgmentsProc } from "./procedures/list-acknowledgments";

export const acknowledgmentsRouter = {
	list: listAcknowledgmentsProc,
	get: getAcknowledgmentProc,
	acknowledge: acknowledgeProc,
	getMyStatus: getMyStatusProc,
};

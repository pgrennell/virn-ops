// Phase 16 -- approvals module router. version_approval lifecycle:
// request -> decide -> publish-gate. Distinct from the Phase 9.5g concierge
// review flow (workflow-level review_state).

import { decideApprovalProc } from "./procedures/decide-approval";
import { getLatestProc } from "./procedures/get-latest";
import { listPendingProc } from "./procedures/list-pending";
import { requestApprovalProc } from "./procedures/request-approval";

export const approvalsRouter = {
	request: requestApprovalProc,
	decide: decideApprovalProc,
	getLatest: getLatestProc,
	listPending: listPendingProc,
};

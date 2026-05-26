import { completeStepProc } from "./procedures/complete-step";
import { completeStepAsGuestProc } from "./procedures/complete-step-as-guest";
import { getHomeSummaryProc } from "./procedures/get-home-summary";
import { getRunProc } from "./procedures/get-run";
import { getRunForGuestProc } from "./procedures/get-run-for-guest";
import { issueParticipantTokenProc } from "./procedures/issue-participant-token";
import { launchRunProc } from "./procedures/launch-run";
import { listActiveRunsProc } from "./procedures/list-active-runs";
import { listMyTasksProc } from "./procedures/list-my-tasks";
import { revokeParticipantTokenProc } from "./procedures/revoke-participant-token";
import { setFieldValueProc } from "./procedures/set-field-value";
import { setFieldValueAsGuestProc } from "./procedures/set-field-value-as-guest";

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
	// Phase 3.5: tokenized guest access. Public (token-authed, rate-limited by IP) +
	// admin-only issue/revoke. See lib/guest.ts for the security boundary.
	getForGuest: getRunForGuestProc,
	setFieldValueAsGuest: setFieldValueAsGuestProc,
	completeStepAsGuest: completeStepAsGuestProc,
	issueParticipantToken: issueParticipantTokenProc,
	revokeParticipantToken: revokeParticipantTokenProc,
};

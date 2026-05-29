import { completeStepProc } from "./procedures/complete-step";
import { completeStepAsGuestProc } from "./procedures/complete-step-as-guest";
import { getHomeSummaryProc } from "./procedures/get-home-summary";
import { getRunProc } from "./procedures/get-run";
import { getRunForGuestProc } from "./procedures/get-run-for-guest";
import { issueParticipantTokenProc } from "./procedures/issue-participant-token";
import { launchRunProc } from "./procedures/launch-run";
import { listActivityProc } from "./procedures/list-activity";
import { listActiveRunsProc } from "./procedures/list-active-runs";
import { listForEntityProc } from "./procedures/list-for-entity";
import { listMyTasksProc } from "./procedures/list-my-tasks";
import { revokeParticipantTokenProc } from "./procedures/revoke-participant-token";
import { runSlaSweepNow } from "./procedures/run-sla-sweep-now";
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
	// Phase 10 / v1.5c (PRD §6.4 / R5 cont.) -- per-run activity timeline
	// rendered in the Read view's right column when opened with ?runId=.
	listActivity: listActivityProc,
	// Phase 10 / v1.5c (PRD §6.5 / R6 lift) -- entity-detail page's
	// Active Run right-rail card data source.
	listForEntity: listForEntityProc,
	getHomeSummary: getHomeSummaryProc,
	// Phase 8 step 5: admin-triggered SLA sweep for the active org. Vercel Cron
	// (apps/saas/app/api/cron/sla-sweep) handles the scheduled platform-wide sweep;
	// this is the manual trigger surface for dev parity + admin one-offs.
	runSlaSweepNow,
	// Phase 3.5: tokenized guest access. Public (token-authed, rate-limited by IP) +
	// admin-only issue/revoke. See lib/guest.ts for the security boundary.
	getForGuest: getRunForGuestProc,
	setFieldValueAsGuest: setFieldValueAsGuestProc,
	completeStepAsGuest: completeStepAsGuestProc,
	issueParticipantToken: issueParticipantTokenProc,
	revokeParticipantToken: revokeParticipantTokenProc,
};

// packages/api/modules/workflows/lib/reattestation-sweep.ts
//
// Phase 16 (Slice D) -- re-attestation sweep. Mirror of runs/lib/sla-sweep:
// find workflows whose `next_review_at` has passed; for each, write an audit
// row + advance `next_review_at` forward by `review_interval_days` so the
// next sweep doesn't re-fire on the same row until the next cycle.
//
// What "due" means here (deliberately thin):
//   - One audit_log row per swept workflow:
//     action='workflow.reattestation_due', changes carry the previous +
//     advanced next_review_at for forensics.
//   - One activity_event row mirroring the audit row -- surfaces in the
//     workflow's audit timeline (Phase 15) so admins see "review due fired
//     on X" historically.
//   - **No notifications yet** -- adding a REATTESTATION_DUE notification
//     type is a schema migration we're deferring. Today, the audit timeline
//     + the workflow's settings page surface the cadence; a future revision
//     wires the existing ACKNOWLEDGMENT_DUE (or a new) enum value to push
//     into the user-visible notifications surface.
//
// Triggers:
//   - Vercel Cron HTTP endpoint at `/api/cron/reattestation-sweep` (prod)
//     -- platform-wide sweep, daily.
//   - For dev parity: a one-shot HTTP call against the same endpoint with
//     CRON_SECRET (no admin manual-trigger procedure yet; can add later if
//     dogfooding shows the friction matters).

import {
	advanceWorkflowNextReviewAt,
	findWorkflowsDueForReattestation,
	type ReattestationDueRow,
	writeAuditAndActivity,
} from "@virn/database";

export interface ReattestationSweepResult {
	/** Total candidate workflows the sweep found (next_review_at <= now + interval set + not archived). */
	scanned: number;
	/** Workflows actually advanced this sweep (== `scanned` unless individual
	 * advance updates lost the WHERE-previous race or audit writes errored). */
	advanced: number;
	/** Detail rows for observability + the admin UI's log. */
	workflows: Array<{
		workflowId: string;
		organizationId: string;
		title: string;
		previousNextReviewAt: Date;
		newNextReviewAt: Date;
	}>;
}

/** Compute the next-cycle date. Adds `intervalDays` to the SUPPLIED previous
 * date (not `now`) so a sweep that runs late still lands on the canonical
 * cycle grid -- prevents drift across long-running orgs. */
function computeNextReviewAt(previous: Date, intervalDays: number): Date {
	const next = new Date(previous);
	next.setDate(next.getDate() + intervalDays);
	return next;
}

async function emitReattestationDue(
	row: ReattestationDueRow,
	actorUserId: string | null,
	newNextReviewAt: Date,
): Promise<void> {
	await writeAuditAndActivity({
		organizationId: row.organizationId,
		// Mirror of the SLA sweep: actorUserId is the admin who triggered the
		// sweep (when a manual trigger exists) or null for the Vercel-Cron
		// path. actorKind defaults to 'user'.
		actorUserId,
		action: "workflow.reattestation_due",
		verb: "due for re-attestation",
		entityType: "workflow",
		entityId: row.id,
		changes: {
			previousNextReviewAt: row.nextReviewAt.toISOString(),
			newNextReviewAt: newNextReviewAt.toISOString(),
			reviewIntervalDays: row.reviewIntervalDays,
		},
		metadata: {
			source: actorUserId ? "manual_admin_sweep" : "scheduled_reattestation_sweep",
		},
		activityData: {
			workflowTitle: row.title,
			reviewIntervalDays: row.reviewIntervalDays,
		},
	});
}

export async function runReattestationSweep(input: {
	organizationId: string | null;
	actorUserId: string | null;
	now?: Date;
}): Promise<ReattestationSweepResult> {
	const now = input.now ?? new Date();
	const candidates = await findWorkflowsDueForReattestation(
		input.organizationId,
		now,
	);

	const workflows: ReattestationSweepResult["workflows"] = [];
	let advanced = 0;
	for (const row of candidates) {
		try {
			const newNextReviewAt = computeNextReviewAt(row.nextReviewAt, row.reviewIntervalDays);
			const didAdvance = await advanceWorkflowNextReviewAt({
				workflowId: row.id,
				previousNextReviewAt: row.nextReviewAt,
				newNextReviewAt,
			});
			if (!didAdvance) {
				// Another sweep got there first (concurrent run). Skip without
				// emitting -- the other run will have written the audit row.
				continue;
			}
			await emitReattestationDue(row, input.actorUserId, newNextReviewAt);
			advanced += 1;
			workflows.push({
				workflowId: row.id,
				organizationId: row.organizationId,
				title: row.title,
				previousNextReviewAt: row.nextReviewAt,
				newNextReviewAt,
			});
		} catch {
			// Per-row failure: skip + continue. If the advance succeeded but
			// the audit write didn't, the audit row is missing for this cycle
			// but the row is excluded from the next sweep (cycle already
			// advanced) -- log-only loss, no incorrect re-fire.
		}
	}

	return {
		scanned: candidates.length,
		advanced,
		workflows,
	};
}

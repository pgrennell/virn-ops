// packages/api/inngest/events.ts
//
// Phase 18b -- the Inngest event contract for Playbooks execution. Centralizes
// the event NAMES + payload shapes so the dispatcher (subscribes to lifecycle
// events), the orchestrator (subscribes to playbook/run.start, waits on
// playbook/wait.signal), and the emit sites (complete-step / entitysets /
// vendors libs) all agree on one source of truth.
//
// Event taxonomy:
//   - Lifecycle events (run.completed / run.state_changed / listing.entity_set_added
//     / vendor.upserted) -- emitted at app chokepoints; the dispatcher subscribes
//     and fans out to matching active playbooks. (Emission lands in 18b-2.)
//   - playbook/run.start -- the dispatcher (or launchManual) emits this to kick the
//     orchestrator for a specific, already-persisted playbook_run row.
//   - playbook/wait.signal -- resumes a run blocked on a `wait_for_event` step. The
//     orchestrator's step.waitForEvent matches on `data.waitKey`.

/** Lifecycle event names the Playbook dispatcher subscribes to. String values
 * match `playbook_lifecycle_event` enum + the existing cross-product event types
 * so the same strings flow through both the Inngest bus and the PM outbox. */
export const PLAYBOOK_LIFECYCLE_EVENTS = {
	RUN_COMPLETED: "run.completed",
	RUN_STATE_CHANGED: "run.state_changed",
	LISTING_ENTITY_SET_ADDED: "listing.entity_set_added",
	VENDOR_UPSERTED: "vendor.upserted",
} as const;

export type PlaybookLifecycleEventName =
	(typeof PLAYBOOK_LIFECYCLE_EVENTS)[keyof typeof PLAYBOOK_LIFECYCLE_EVENTS];

/** Internal orchestration events. */
export const PLAYBOOK_RUN_START_EVENT = "playbook/run.start" as const;
export const PLAYBOOK_WAIT_SIGNAL_EVENT = "playbook/wait.signal" as const;

/** Payload for a lifecycle event the dispatcher consumes. `entityType`/`entityId`
 * locate the entity whose entity-set memberships are matched against each active
 * playbook's `entity_set_ids` scope; `crossProductOrigin` is propagated onto any
 * spawned playbook_run so D-027 attribution survives the whole chain. */
export interface PlaybookLifecycleEventData {
	organizationId: string;
	entityType: string | null;
	entityId: string | null;
	crossProductOrigin?: string | null;
	/** Free-form trigger context preserved on the playbook_run for branch
	 * evaluators + forensic replay (e.g. the run's from/to status). */
	payload?: Record<string, unknown>;
}

/** Payload for playbook/run.start. The run row already exists (pending); the
 * orchestrator loads it by id and drives it to a terminal state. */
export interface PlaybookRunStartEventData {
	playbookRunId: string;
	organizationId: string;
}

/** Payload for playbook/wait.signal. `waitKey` is the deterministic key a
 * `wait_for_event` step blocks on -- see buildWaitKey. */
export interface PlaybookWaitSignalEventData {
	waitKey: string;
	organizationId: string;
	payload?: Record<string, unknown>;
}

/** Deterministic key a `wait_for_event` step waits on, and that a matching
 * inbound signal must carry. Scoped by org + entity so two runs waiting on the
 * same logical event for different entities don't cross-resume. */
export function buildWaitKey(input: {
	organizationId: string;
	entityType: string | null;
	entityId: string | null;
	eventName: string;
}): string {
	return [
		input.organizationId,
		input.entityType ?? "_",
		input.entityId ?? "_",
		input.eventName,
	].join(":");
}

// packages/api/modules/playbook-runs/lib/dispatch.ts
//
// Phase 18b-2 -- the PURE matching logic the Inngest dispatcher uses to fan an
// inbound lifecycle event out to the playbooks that should fire. Kept here (not
// in the durable function) so it unit-tests without Inngest: feed triggers +
// an event + candidate entity-set ids, assert the selected subset.

import type { PlaybookTriggerRow } from "@virn/database";

/** Does this active-playbook trigger fire for `event` against an entity with the
 * given entity-set memberships? A playbook with an empty entity-set scope
 * applies to ANY entity; otherwise its scope must intersect the candidates. */
export function playbookTriggerMatches(
	trigger: Pick<PlaybookTriggerRow, "triggerType" | "triggerEvent" | "entitySetIds">,
	event: string,
	candidateEntitySetIds: string[],
): boolean {
	if (trigger.triggerType !== "lifecycle_event") return false;
	if (trigger.triggerEvent !== event) return false;
	if (trigger.entitySetIds.length === 0) return true;
	return trigger.entitySetIds.some((id) => candidateEntitySetIds.includes(id));
}

export function selectMatchingPlaybooks(
	triggers: PlaybookTriggerRow[],
	event: string,
	candidateEntitySetIds: string[],
): PlaybookTriggerRow[] {
	return triggers.filter((t) =>
		playbookTriggerMatches(t, event, candidateEntitySetIds),
	);
}

/** Deterministic dedup fingerprint: a duplicate inbound event for the same
 * subject hashes identically and collides on uq_playbook_run_dedup, so the
 * dispatcher seeds at most one run per (version, entity, subject). Prefers a
 * stable subject id from the payload (e.g. the completed run id) over the bare
 * entity id. */
export function buildDispatchFingerprint(input: {
	event: string;
	entityId: string | null;
	payload?: Record<string, unknown>;
}): string {
	const subject =
		(typeof input.payload?.runId === "string" && input.payload.runId) ||
		input.entityId ||
		"_";
	return `${input.event}:${subject}`;
}

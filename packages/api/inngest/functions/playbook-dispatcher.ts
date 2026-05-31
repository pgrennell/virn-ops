// packages/api/inngest/functions/playbook-dispatcher.ts
//
// Phase 18b-2 -- the Playbook dispatcher. Subscribes to the four lifecycle
// events; for each, loads the org's ACTIVE playbook triggers (is_active gate is
// in the query), matches by event + entity-set scope (pure selectMatchingPlaybooks),
// seeds an idempotent playbook_run per match, and kicks the orchestrator. The
// dedup constraint + buildDispatchFingerprint make duplicate inbound events
// no-ops (the second insert collides and `created` is false).

import { insertPlaybookRun, listActivePlaybookTriggers } from "@virn/database";

import { inngest } from "../client";
import {
	PLAYBOOK_LIFECYCLE_EVENTS,
	PLAYBOOK_RUN_START_EVENT,
	type PlaybookLifecycleEventData,
} from "../events";
import {
	buildDispatchFingerprint,
	selectMatchingPlaybooks,
} from "../../modules/playbook-runs/lib/dispatch";

function readStringArray(v: unknown): string[] {
	return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export const playbookDispatcher = inngest.createFunction(
	{ id: "playbook-dispatcher", name: "Playbook dispatcher", retries: 3 },
	[
		{ event: PLAYBOOK_LIFECYCLE_EVENTS.RUN_COMPLETED },
		{ event: PLAYBOOK_LIFECYCLE_EVENTS.RUN_STATE_CHANGED },
		{ event: PLAYBOOK_LIFECYCLE_EVENTS.LISTING_ENTITY_SET_ADDED },
		{ event: PLAYBOOK_LIFECYCLE_EVENTS.VENDOR_UPSERTED },
	],
	async ({ event, step }) => {
		const data = event.data as PlaybookLifecycleEventData;
		if (!data?.organizationId) return { skipped: "no organizationId" };

		// Candidate entity-set memberships used to narrow scoped playbooks. Emit
		// sites that know them include `payload.entitySetIds`; events without it
		// only fire match-any (empty-scope) playbooks.
		const candidateEntitySetIds = readStringArray(data.payload?.entitySetIds);

		const triggers = await step.run("load-triggers", () =>
			listActivePlaybookTriggers(data.organizationId),
		);
		const matches = selectMatchingPlaybooks(triggers, event.name, candidateEntitySetIds);
		if (matches.length === 0) return { matched: 0 };

		let seeded = 0;
		for (const match of matches) {
			const fingerprint = buildDispatchFingerprint({
				event: event.name,
				entityId: data.entityId,
				payload: data.payload,
			});
			const { run, created } = await step.run(
				`seed-${match.playbookVersionId}`,
				() =>
					insertPlaybookRun({
						organizationId: data.organizationId,
						playbookVersionId: match.playbookVersionId,
						triggerEntityType: data.entityType,
						triggerEntityId: data.entityId,
						triggerPayload: data.payload ?? {},
						triggerFingerprint: fingerprint,
						crossProductOrigin: data.crossProductOrigin ?? null,
					}),
			);
			if (created) {
				await step.sendEvent(`start-${run.id}`, {
					name: PLAYBOOK_RUN_START_EVENT,
					data: { playbookRunId: run.id, organizationId: data.organizationId },
				});
				seeded += 1;
			}
		}

		return { matched: matches.length, seeded };
	},
);

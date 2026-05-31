// packages/api/modules/playbook-runs/lib/run-control.ts
//
// Phase 18b -- the launch + cancel entry points for playbook execution.
// launchPlaybookManual seeds a playbook_run from the latest PUBLISHED version
// (ignoring is_active -- operator-initiated, intentional override per PRD §6.4)
// and kicks the Inngest orchestrator. cancelPlaybookRunOp flips a live run to
// 'cancelled'; the orchestrator checks status between steps and stops.
//
// Org-scoping + typed refusals live here (PlaybookEngineError -> ORPCError via
// the playbooks _utils map). The DB writes are in @virn/database; the event emit
// is the only Inngest coupling.

import {
	cancelPlaybookRun,
	getLatestPublishedPlaybookVersion,
	getPlaybookForOrg,
	getPlaybookRunForOrg,
	insertPlaybookRun,
	writeAuditAndActivity,
} from "@virn/database";

import { PlaybookEngineError } from "../../playbooks/lib/errors";
import { inngest } from "../../../inngest/client";
import { PLAYBOOK_RUN_START_EVENT } from "../../../inngest/events";

export interface PlaybookRunControlContext {
	organizationId: string;
	userId: string;
}

export interface LaunchManualInput {
	playbookId: string;
	/** Optional entity the run is launched against -- stamped onto the run so the
	 * Active Run card can surface it on the entity's detail page. */
	entityContext?: { entityType: string; entityId: string } | null;
}

export async function launchPlaybookManual(
	ctx: PlaybookRunControlContext,
	input: LaunchManualInput,
): Promise<{ playbookRunId: string }> {
	const pb = await getPlaybookForOrg({
		organizationId: ctx.organizationId,
		playbookId: input.playbookId,
	});
	if (!pb) {
		throw new PlaybookEngineError("PLAYBOOK_NOT_FOUND", "Playbook not found.", {
			playbookId: input.playbookId,
		});
	}

	const version = await getLatestPublishedPlaybookVersion(pb.id);
	if (!version) {
		throw new PlaybookEngineError(
			"PLAYBOOK_NOT_PUBLISHED",
			"Playbook has no published version to run. Publish a version first.",
			{ playbookId: pb.id },
		);
	}

	const entityType = input.entityContext?.entityType ?? null;
	const entityId = input.entityContext?.entityId ?? null;

	// Manual launches use a unique fingerprint so every click yields a fresh run
	// (the dedup constraint is for the dispatcher's duplicate-event drop, not here).
	const { run } = await insertPlaybookRun({
		organizationId: ctx.organizationId,
		playbookVersionId: version.id,
		triggerEntityType: entityType,
		triggerEntityId: entityId,
		triggerPayload: {
			source: "manual",
			launchedByUserId: ctx.userId,
			entity: input.entityContext ?? null,
		},
		triggerFingerprint: `manual:${ctx.userId}:${Date.now()}`,
		crossProductOrigin: null,
	});

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "playbook_run.launched",
		verb: "launched",
		entityType: "playbook_run",
		entityId: run.id,
		metadata: { playbookId: pb.id, playbookVersionId: version.id, source: "manual" },
	});

	await inngest.send({
		name: PLAYBOOK_RUN_START_EVENT,
		data: { playbookRunId: run.id, organizationId: ctx.organizationId },
	});

	return { playbookRunId: run.id };
}

export async function cancelPlaybookRunOp(
	ctx: PlaybookRunControlContext,
	input: { runId: string },
): Promise<{ cancelled: true }> {
	const existing = await getPlaybookRunForOrg({
		organizationId: ctx.organizationId,
		runId: input.runId,
	});
	if (!existing) {
		throw new PlaybookEngineError("PLAYBOOK_RUN_NOT_FOUND", "Playbook run not found.", {
			runId: input.runId,
		});
	}

	const ok = await cancelPlaybookRun({
		runId: input.runId,
		organizationId: ctx.organizationId,
		cancelledByUserId: ctx.userId,
	});
	if (!ok) {
		throw new PlaybookEngineError(
			"PLAYBOOK_RUN_NOT_CANCELLABLE",
			`Run is already ${existing.status} and cannot be cancelled.`,
			{ runId: input.runId, status: existing.status },
		);
	}

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "playbook_run.cancelled",
		verb: "cancelled",
		entityType: "playbook_run",
		entityId: input.runId,
	});

	return { cancelled: true };
}

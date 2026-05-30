// packages/api/modules/acknowledgments/lib/acknowledge.ts
//
// Phase 16 -- acknowledge action surface (WRITE path). The READ side shipped
// in Phase 15; this completes the loop. Org members can acknowledge a
// published workflow_version they're entitled to see; the row is idempotent
// against the (workflowVersionId, userId) unique constraint.
//
// Gating: the procedure layer rejects when the org's `governance.acknowledgments`
// capability is OFF -- the surface should be invisible without the cap, but
// defense-in-depth catches a direct procedure call. Pre-checks org-scope +
// published-status so the row never points at a draft or a foreign org's
// version (mirror of markVersionAsRead's shape in workflows/lib/read-receipts).

import { ORPCError } from "@orpc/server";
import {
	acknowledgeWorkflowVersion,
	getVersionWithWorkflow,
	hasUserAcknowledgedVersion,
	isCapabilityEnabledForOrg,
	writeAuditAndActivity,
} from "@virn/database";

export interface AcknowledgeContext {
	organizationId: string;
	userId: string;
}

export interface AcknowledgeInput {
	workflowVersionId: string;
}

export interface AcknowledgeResult {
	id: string;
	acknowledgedAt: Date;
	alreadyExisted: boolean;
}

/** The capability key gating the ack write path. Centralized so tests + the
 * UI can reference the same literal. */
export const ACK_CAPABILITY_KEY = "governance.acknowledgments";

export async function acknowledgeVersion(
	ctx: AcknowledgeContext,
	input: AcknowledgeInput,
): Promise<AcknowledgeResult> {
	const bundle = await getVersionWithWorkflow(input.workflowVersionId);
	if (!bundle || bundle.workflow.organizationId !== ctx.organizationId) {
		// Same cross-org NOT_FOUND posture as markVersionAsRead -- don't
		// distinguish "no such version" from "foreign org's version" to keep
		// enumeration unattractive.
		throw new ORPCError("NOT_FOUND", {
			message: "Workflow version not found.",
			data: { code: "VERSION_NOT_FOUND" },
		});
	}
	if (bundle.version.status !== "published") {
		throw new ORPCError("BAD_REQUEST", {
			message: `Cannot acknowledge a ${bundle.version.status} version; only published versions accept acknowledgments.`,
			data: { code: "VERSION_NOT_PUBLISHED", status: bundle.version.status },
		});
	}
	const capEnabled = await isCapabilityEnabledForOrg(
		ctx.organizationId,
		ACK_CAPABILITY_KEY,
	);
	if (!capEnabled) {
		throw new ORPCError("FORBIDDEN", {
			message: "Acknowledgments are not enabled for this organization.",
			data: { code: "CAPABILITY_DISABLED", capability: ACK_CAPABILITY_KEY },
		});
	}

	const result = await acknowledgeWorkflowVersion({
		organizationId: ctx.organizationId,
		workflowVersionId: input.workflowVersionId,
		userId: ctx.userId,
	});

	// Only emit audit/activity on a fresh insert; re-acknowledging is a no-op
	// and shouldn't pollute the timeline with duplicate "acknowledged" verbs.
	if (!result.alreadyExisted) {
		await writeAuditAndActivity({
			organizationId: ctx.organizationId,
			actorUserId: ctx.userId,
			actorKind: "user",
			action: "acknowledgment.created",
			verb: "acknowledged",
			entityType: "acknowledgment",
			entityId: result.id,
			activityData: {
				workflowId: bundle.workflow.id,
				workflowVersionId: input.workflowVersionId,
				workflowVersionNumber: bundle.version.versionNumber,
			},
		});
	}

	return result;
}

export interface GetMyAckStatusResult {
	hasAcknowledged: boolean;
	acknowledgedAt: Date | null;
}

/** Read-shaped status check for the Read view's Acknowledge button. Cross-org
 * versions return `{ hasAcknowledged: false }` (mirror of getMyReadStatus's
 * posture) so the UI doesn't need to distinguish "not yours" from "not yet." */
export async function getMyAcknowledgmentStatus(
	ctx: AcknowledgeContext,
	input: AcknowledgeInput,
): Promise<GetMyAckStatusResult> {
	const bundle = await getVersionWithWorkflow(input.workflowVersionId);
	if (!bundle || bundle.workflow.organizationId !== ctx.organizationId) {
		return { hasAcknowledged: false, acknowledgedAt: null };
	}
	const row = await hasUserAcknowledgedVersion({
		workflowVersionId: input.workflowVersionId,
		userId: ctx.userId,
	});
	if (!row) return { hasAcknowledged: false, acknowledgedAt: null };
	return { hasAcknowledged: true, acknowledgedAt: row.acknowledgedAt };
}

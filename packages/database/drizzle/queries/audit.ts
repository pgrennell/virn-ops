// packages/database/drizzle/queries/audit.ts
//
// Phase 15 -- audit_log read surface for the thin compliance / evidence reader
// (S-10). Mirror of listActivityForRun's shape (queries/runs.ts) but reads from
// audit_log (the rich app-level intent log) instead of activity_event (the
// user-visible feed).
//
// Why both surfaces exist:
//   - activity_event = "what happened, in user-facing language" (feed-shaped).
//     Already powers the Read view's per-run timeline.
//   - audit_log = "what happened, with the diff/payload for forensics."
//     Carries `changes` + `metadata` JSON; the compliance reader surfaces
//     the diff explicitly so reviewers can see "title changed from X to Y."
//
// Org-scoped (Invariant #1). Polymorphic via (entityType, entityId) per the
// existing audit_log shape. Caller-controlled paging + total count so the
// monitor UI can render "viewing 1-25 of N".

import { and, count, desc, eq } from "drizzle-orm";

import { db } from "../client";
import { auditLog, user, type entityType as entityTypeEnum } from "../schema/postgres";

export type AuditEntityType = (typeof entityTypeEnum)["enumValues"][number];

/** Row shape returned to the compliance reader. The actor's display name is
 * left-joined from `user` and is null when the actor is a guest / agent /
 * vendor (or the user record has been deleted -- the schema sets
 * actor_user_id to NULL on user delete). The compliance UI falls back to
 * actorKind + actorParticipantId for those cases. */
export interface AuditLogRow {
	id: string;
	action: string;
	actorKind: "user" | "guest" | "agent" | "vendor";
	actorUserId: string | null;
	actorUserName: string | null;
	actorUserEmail: string | null;
	actorParticipantId: string | null;
	crossProductOrigin: string | null;
	entityType: AuditEntityType;
	entityId: string;
	changes: Record<string, unknown> | null;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
}

export interface ListAuditLogInput {
	organizationId: string;
	entityType: AuditEntityType;
	entityId: string;
	limit?: number;
	offset?: number;
}

export interface ListAuditLogResult {
	rows: AuditLogRow[];
	totalCount: number;
}

/** Fetch the audit log for a specific entity, newest first. Org-scoped + pinned
 * to (entityType, entityId). Returns rows + totalCount in parallel so the
 * monitor UI can paginate without a second round trip.
 *
 * The actor join is LEFT JOIN to `user` -- compliance never blocks on a
 * deleted-user row. The activity timeline in queries/runs.ts uses the same
 * pattern; reusing it keeps the audit + activity surfaces' actor-rendering
 * code consistent. */
export async function listAuditLogForEntity(
	input: ListAuditLogInput,
): Promise<ListAuditLogResult> {
	const limit = input.limit ?? 25;
	const offset = input.offset ?? 0;

	const where = and(
		eq(auditLog.organizationId, input.organizationId),
		eq(auditLog.entityType, input.entityType),
		eq(auditLog.entityId, input.entityId),
	);

	const [rows, totalRow] = await Promise.all([
		db
			.select({
				id: auditLog.id,
				action: auditLog.action,
				actorKind: auditLog.actorKind,
				actorUserId: auditLog.actorUserId,
				actorUserName: user.name,
				actorUserEmail: user.email,
				actorParticipantId: auditLog.actorParticipantId,
				crossProductOrigin: auditLog.crossProductOrigin,
				entityType: auditLog.entityType,
				entityId: auditLog.entityId,
				changes: auditLog.changes,
				metadata: auditLog.metadata,
				createdAt: auditLog.createdAt,
			})
			.from(auditLog)
			.leftJoin(user, eq(user.id, auditLog.actorUserId))
			.where(where)
			.orderBy(desc(auditLog.createdAt))
			.limit(limit)
			.offset(offset),
		db
			.select({ value: count() })
			.from(auditLog)
			.where(where)
			.then((r) => r[0] ?? { value: 0 }),
	]);

	return {
		rows: rows.map((r) => ({
			id: r.id,
			action: r.action,
			actorKind: r.actorKind,
			actorUserId: r.actorUserId,
			actorUserName: r.actorUserName,
			actorUserEmail: r.actorUserEmail,
			actorParticipantId: r.actorParticipantId,
			crossProductOrigin: r.crossProductOrigin,
			entityType: r.entityType,
			entityId: r.entityId,
			changes: r.changes as Record<string, unknown> | null,
			metadata: r.metadata as Record<string, unknown> | null,
			createdAt: r.createdAt,
		})),
		totalCount: Number(totalRow.value),
	};
}

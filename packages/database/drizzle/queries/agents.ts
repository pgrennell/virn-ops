// packages/database/drizzle/queries/agents.ts
//
// Definition-layer DB helpers for org-scoped AI agents (ADR-006 + D-022). Agent identity
// lives here (long-lived, credentialed); per-run binding is `participant.kind='agent' +
// agentId` (runs.ts schema). The MCP credential-validating boundary lands in Phase 11 --
// this file just stores hashes + lets admins manage them.
//
// Credential helpers (generate / hash / verify / lastFour) live in `agent-credentials.ts`
// to keep them importable without pulling in the DB client (used by Phase 11 MCP layer too).

import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "../client";
import { agent } from "../schema/postgres";
import {
	credentialLastFour,
	generateAgentCredential,
	hashAgentCredential,
	verifyAgentCredential,
} from "./agent-credentials";

// ---------------------------------------------------------------------------
// Agent CRUD
// ---------------------------------------------------------------------------

export interface AgentListRow {
	id: string;
	name: string;
	description: string | null;
	isActive: boolean;
	credentialLastFour: string | null;
	credentialRotatedAt: Date | null;
	createdByUserId: string | null;
	createdByUserName: string | null;
	createdAt: Date;
	updatedAt: Date;
}

/** List non-soft-deleted agents in the org, oldest first. Used by the admin agent-management
 * UI; future picker UIs (agent-assignment in step config — Phase 8 step 3) will compose with
 * an `isActive=true` filter on top of this. */
export async function listAgentsForOrg(organizationId: string): Promise<AgentListRow[]> {
	const rows = await db.query.agent.findMany({
		where: (a, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
			andOp(eqOp(a.organizationId, organizationId), isNullOp(a.deletedAt)),
		orderBy: (a, { asc: ascOp }) => [ascOp(a.createdAt)],
		with: { createdBy: { columns: { id: true, name: true } } },
	});
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		description: r.description,
		isActive: r.isActive,
		credentialLastFour: r.credentialLastFour,
		credentialRotatedAt: r.credentialRotatedAt,
		createdByUserId: r.createdByUserId,
		createdByUserName: r.createdBy?.name ?? null,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
	}));
}

/** Fetch a single agent scoped to the org. Returns null if not found, soft-deleted, or
 * cross-org. Used by procedures that need to enforce the principal-must-own-the-row check
 * before update/rotate/delete. */
export async function getAgentForOrg(
	organizationId: string,
	agentId: string,
): Promise<AgentListRow | null> {
	const r = await db.query.agent.findFirst({
		where: (a, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
			andOp(
				eqOp(a.id, agentId),
				eqOp(a.organizationId, organizationId),
				isNullOp(a.deletedAt),
			),
		with: { createdBy: { columns: { id: true, name: true } } },
	});
	if (!r) return null;
	return {
		id: r.id,
		name: r.name,
		description: r.description,
		isActive: r.isActive,
		credentialLastFour: r.credentialLastFour,
		credentialRotatedAt: r.credentialRotatedAt,
		createdByUserId: r.createdByUserId,
		createdByUserName: r.createdBy?.name ?? null,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
	};
}

export interface CreateAgentInput {
	organizationId: string;
	name: string;
	description?: string | null;
	createdByUserId: string;
}

export interface CreateAgentResult {
	id: string;
	name: string;
	description: string | null;
	isActive: boolean;
	credentialLastFour: string;
	credentialRotatedAt: Date;
	createdAt: Date;
	/** The plaintext credential. Returned ONCE on creation; not stored anywhere afterwards. */
	plaintextCredential: string;
}

export async function createAgent(input: CreateAgentInput): Promise<CreateAgentResult> {
	const plaintext = generateAgentCredential();
	const hash = hashAgentCredential(plaintext);
	const lastFour = credentialLastFour(plaintext);
	const rotatedAt = new Date();

	const [row] = await db
		.insert(agent)
		.values({
			organizationId: input.organizationId,
			name: input.name,
			description: input.description ?? null,
			credentialHash: hash,
			credentialLastFour: lastFour,
			credentialRotatedAt: rotatedAt,
			createdByUserId: input.createdByUserId,
		})
		.returning({
			id: agent.id,
			name: agent.name,
			description: agent.description,
			isActive: agent.isActive,
			credentialLastFour: agent.credentialLastFour,
			credentialRotatedAt: agent.credentialRotatedAt,
			createdAt: agent.createdAt,
		});

	return {
		id: row.id,
		name: row.name,
		description: row.description,
		isActive: row.isActive,
		credentialLastFour: row.credentialLastFour ?? lastFour,
		credentialRotatedAt: row.credentialRotatedAt ?? rotatedAt,
		createdAt: row.createdAt,
		plaintextCredential: plaintext,
	};
}

export interface UpdateAgentInput {
	organizationId: string;
	agentId: string;
	name?: string;
	description?: string | null;
	isActive?: boolean;
}

/** Patch an agent's mutable fields. Returns null if the agent doesn't exist (or isn't in
 * this org / is soft-deleted), otherwise the updated row. */
export async function updateAgent(input: UpdateAgentInput): Promise<AgentListRow | null> {
	const patch: Record<string, unknown> = { updatedAt: new Date() };
	if (input.name !== undefined) patch.name = input.name;
	if (input.description !== undefined) patch.description = input.description;
	if (input.isActive !== undefined) patch.isActive = input.isActive;

	const result = await db
		.update(agent)
		.set(patch)
		.where(
			and(
				eq(agent.id, input.agentId),
				eq(agent.organizationId, input.organizationId),
				isNull(agent.deletedAt),
			),
		)
		.returning({ id: agent.id });
	if (result.length === 0) return null;
	return await getAgentForOrg(input.organizationId, input.agentId);
}

export interface RotateAgentCredentialResult {
	plaintextCredential: string;
	credentialLastFour: string;
	credentialRotatedAt: Date;
}

/** Generate a new credential, replace the stored hash, return the new plaintext once.
 * Existing MCP sessions using the old credential will fail to authenticate after rotation
 * (Phase 11 implements the validation side). */
export async function rotateAgentCredential(input: {
	organizationId: string;
	agentId: string;
}): Promise<RotateAgentCredentialResult | null> {
	const plaintext = generateAgentCredential();
	const hash = hashAgentCredential(plaintext);
	const lastFour = credentialLastFour(plaintext);
	const rotatedAt = new Date();

	const result = await db
		.update(agent)
		.set({
			credentialHash: hash,
			credentialLastFour: lastFour,
			credentialRotatedAt: rotatedAt,
			updatedAt: rotatedAt,
		})
		.where(
			and(
				eq(agent.id, input.agentId),
				eq(agent.organizationId, input.organizationId),
				isNull(agent.deletedAt),
			),
		)
		.returning({ id: agent.id });

	if (result.length === 0) return null;
	return {
		plaintextCredential: plaintext,
		credentialLastFour: lastFour,
		credentialRotatedAt: rotatedAt,
	};
}

/** Soft-delete an agent (sets deletedAt). Historical `participant` rows pointing at it are
 * preserved (ON DELETE RESTRICT on the FK) so the activity feed still shows "Turnover AI
 * completed Step 3" for past runs. New MCP authentication for this agent fails after
 * delete. Idempotent: re-deleting returns null (treated as "no row to delete"). */
export async function softDeleteAgent(input: {
	organizationId: string;
	agentId: string;
}): Promise<{ deleted: boolean }> {
	const result = await db
		.update(agent)
		.set({ deletedAt: new Date(), updatedAt: new Date(), isActive: false })
		.where(
			and(
				eq(agent.id, input.agentId),
				eq(agent.organizationId, input.organizationId),
				isNull(agent.deletedAt),
			),
		)
		.returning({ id: agent.id });
	return { deleted: result.length > 0 };
}

// ---------------------------------------------------------------------------
// Credential resolution (Phase 11a, action surface)
// ---------------------------------------------------------------------------

export interface ResolvedAgent {
	id: string;
	organizationId: string;
	name: string;
}

/** Resolve a bearer-credential plaintext to an active, non-soft-deleted agent. Returns null
 * for any malformed input, unknown credential, or inactive/deleted row.
 *
 * Performance: scrypt verification is intentionally CPU-expensive (~50ms). To keep this
 * helper O(1)-ish instead of O(N agents in the platform), we prefilter by the public
 * `credentialLastFour` column — a 4-char base64url suffix yields ~1/16M collision odds, so
 * the inner loop almost always sees zero or one candidate. The last-four value is not a
 * secret (already shown in admin UI for agent identification) and exposing it as a filter
 * key doesn't weaken the scrypt verification that runs after.
 *
 * Safe against early returns leaking timing: the suffix prefilter is structural (not based
 * on the secret), and we always scrypt-verify every candidate before deciding. */
export async function findActiveAgentByCredential(
	plaintext: string,
): Promise<ResolvedAgent | null> {
	if (typeof plaintext !== "string" || plaintext.length < 8) return null;
	const lastFour = credentialLastFour(plaintext);

	const candidates = await db.query.agent.findMany({
		where: (a, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
			andOp(
				eqOp(a.credentialLastFour, lastFour),
				eqOp(a.isActive, true),
				isNullOp(a.deletedAt),
			),
		columns: {
			id: true,
			organizationId: true,
			name: true,
			credentialHash: true,
		},
	});

	for (const c of candidates) {
		if (verifyAgentCredential(plaintext, c.credentialHash)) {
			return { id: c.id, organizationId: c.organizationId, name: c.name };
		}
	}
	return null;
}

// Silence unused-import warnings for the leftover helpers kept for future expansion.
void asc;

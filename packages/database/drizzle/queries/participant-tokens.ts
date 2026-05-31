// packages/database/drizzle/queries/participant-tokens.ts
//
// Tokenized guest-participant access (UX_SPEC §5.4, BUILD_PLAN.md Phase 3.5). A
// participant_token grants a non-Better-Auth guest read+write access to ONLY the run
// steps they're assigned to. Plaintext token lives in the URL fragment sent to the
// guest -- never written to disk on our side. We store an HMAC-SHA256 hex of it, keyed
// by a stable server-side secret (`PARTICIPANT_TOKEN_SECRET` env var).
//
// Why HMAC and not argon2id: HMAC is deterministic, so we can index `tokenHash` UNIQUE
// and do O(1) lookups by `WHERE token_hash = HMAC(input)`. Argon2 is non-deterministic
// (salted) -- can't be the lookup key. The secret defends against DB-only leaks: an
// attacker who exfiltrates the table still can't forge new tokens without the secret.
// A 256-bit random plaintext doesn't need slow-KDF protection (it's not low-entropy).
//
// Rotating PARTICIPANT_TOKEN_SECRET invalidates every outstanding link by design. Treat
// it as a stable, long-lived signing key.

import { and, eq, isNull, lte, sql } from "drizzle-orm";

import { db } from "../client";
import { participant, participantToken } from "../schema/postgres";
// D-046: pure token-crypto in a client-free module; imported for internal use, public
// helpers re-exported below.
import { generateTokenPlaintext, hashToken, safeEqual } from "./_pure/token-crypto";

// ---------------------------------------------------------------------------
// Token plaintext + hash
//
// D-046: the pure token-crypto (getSecret/generateTokenPlaintext/hashToken/safeEqual)
// moved to ./_pure/token-crypto.ts so it can be unit-tested without the drizzle client.
// generateTokenPlaintext + hashToken (the public helpers) are re-exported for back-compat;
// safeEqual stays internal (used below in token verification).
// ---------------------------------------------------------------------------

export { generateTokenPlaintext, hashToken };

// ---------------------------------------------------------------------------
// Participant lookup (for the admin issue procedure)
// ---------------------------------------------------------------------------

/** Find a guest participant by id, scoped to the org. Returns null if not found, not in
 * this org, or not a guest (i.e. has a Better Auth userId). Guests are participants with
 * `userId IS NULL` and `guestEmail` set; the schema CHECK enforces the XOR. */
export async function findGuestParticipantForOrg(input: {
	organizationId: string;
	participantId: string;
}): Promise<{
	id: string;
	organizationId: string;
	runId: string;
	guestEmail: string;
	guestName: string | null;
} | null> {
	const rows = await db
		.select({
			id: participant.id,
			organizationId: participant.organizationId,
			runId: participant.runId,
			userId: participant.userId,
			guestEmail: participant.guestEmail,
			guestName: participant.guestName,
		})
		.from(participant)
		.where(
			and(
				eq(participant.id, input.participantId),
				eq(participant.organizationId, input.organizationId),
			),
		)
		.limit(1);
	const p = rows[0];
	if (!p) return null;
	if (p.userId !== null) return null; // Not a guest — internal users don't need tokens.
	if (p.guestEmail === null) return null; // Defensive; schema CHECK prevents this.
	return {
		id: p.id,
		organizationId: p.organizationId,
		runId: p.runId,
		guestEmail: p.guestEmail,
		guestName: p.guestName,
	};
}

// ---------------------------------------------------------------------------
// Issue / verify / revoke
// ---------------------------------------------------------------------------

export interface IssuedToken {
	tokenId: string;
	/** Plaintext token. Returned ONCE on issue; not stored anywhere afterwards. */
	plaintext: string;
	expiresAt: Date;
}

/** Generate a fresh token, store its hash, return the plaintext once. The plaintext goes
 * in the URL fragment (e.g. https://ops.virn.com/run-guest/#token=<plaintext>) -- never
 * in a query string, never logged. */
export async function issueParticipantToken(input: {
	organizationId: string;
	participantId: string;
	expiresInDays?: number;
	issuedByUserId: string;
}): Promise<IssuedToken> {
	const expiresInDays = input.expiresInDays ?? 7;
	const now = new Date();
	const expiresAt = new Date(now);
	expiresAt.setDate(expiresAt.getDate() + expiresInDays);

	const plaintext = generateTokenPlaintext();
	const tokenHash = hashToken(plaintext);

	const [row] = await db
		.insert(participantToken)
		.values({
			organizationId: input.organizationId,
			participantId: input.participantId,
			tokenHash,
			expiresAt,
			issuedByUserId: input.issuedByUserId,
		})
		.returning({ id: participantToken.id });

	return { tokenId: row.id, plaintext, expiresAt };
}

export interface VerifiedToken {
	tokenId: string;
	organizationId: string;
	participantId: string;
	participant: {
		id: string;
		organizationId: string;
		runId: string;
		userId: string | null;
		guestEmail: string | null;
		guestName: string | null;
	};
}

/** Hash the plaintext, look up the row, enforce not-revoked + not-expired. Returns
 * `null` for ANY failure (invalid format, no match, revoked, expired) -- the caller maps
 * to a single FORBIDDEN-class response so an attacker can't distinguish "token doesn't
 * exist" from "token expired". */
export async function verifyParticipantToken(plaintext: string): Promise<VerifiedToken | null> {
	if (typeof plaintext !== "string" || plaintext.length < 32 || plaintext.length > 200) {
		return null;
	}
	let tokenHash: string;
	try {
		tokenHash = hashToken(plaintext);
	} catch {
		return null;
	}

	const rows = await db
		.select({
			id: participantToken.id,
			organizationId: participantToken.organizationId,
			participantId: participantToken.participantId,
			tokenHash: participantToken.tokenHash,
			expiresAt: participantToken.expiresAt,
			revokedAt: participantToken.revokedAt,
		})
		.from(participantToken)
		.where(eq(participantToken.tokenHash, tokenHash))
		.limit(1);

	const row = rows[0];
	if (!row) return null;
	if (!safeEqual(row.tokenHash, tokenHash)) return null;
	if (row.revokedAt !== null) return null;
	if (row.expiresAt <= new Date()) return null;

	const p = await db.query.participant.findFirst({
		where: (pt, { eq: e }) => e(pt.id, row.participantId),
	});
	if (!p) return null;
	if (p.organizationId !== row.organizationId) return null;

	return {
		tokenId: row.id,
		organizationId: row.organizationId,
		participantId: row.participantId,
		participant: p,
	};
}

/** Soft-revoke a token. Audit row is preserved (we never delete the row). Idempotent --
 * re-revoking a revoked token is a no-op. */
export async function revokeParticipantToken(input: {
	organizationId: string;
	tokenId: string;
}): Promise<{ revoked: boolean }> {
	const result = await db
		.update(participantToken)
		.set({ revokedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(participantToken.id, input.tokenId),
				eq(participantToken.organizationId, input.organizationId),
				isNull(participantToken.revokedAt),
			),
		)
		.returning({ id: participantToken.id });
	return { revoked: result.length > 0 };
}

/** Touch the last-used timestamp after a successful guest action. Fire-and-forget; the
 * call site doesn't need to await it for correctness. */
export async function touchParticipantTokenUsage(tokenId: string): Promise<void> {
	await db
		.update(participantToken)
		.set({ lastUsedAt: new Date() })
		.where(eq(participantToken.id, tokenId));
}

/** List active (non-revoked, non-expired) tokens for the given run. Used by the admin
 * issuance UI to show "what links are out there for this run". */
export async function listActiveTokensForRun(input: {
	organizationId: string;
	runId: string;
}): Promise<
	Array<{
		id: string;
		participantId: string;
		guestEmail: string | null;
		guestName: string | null;
		expiresAt: Date;
		lastUsedAt: Date | null;
		issuedAt: Date;
	}>
> {
	const now = new Date();
	const rows = await db
		.select({
			id: participantToken.id,
			participantId: participantToken.participantId,
			guestEmail: participant.guestEmail,
			guestName: participant.guestName,
			expiresAt: participantToken.expiresAt,
			lastUsedAt: participantToken.lastUsedAt,
			issuedAt: participantToken.createdAt,
		})
		.from(participantToken)
		.innerJoin(participant, eq(participant.id, participantToken.participantId))
		.where(
			and(
				eq(participantToken.organizationId, input.organizationId),
				eq(participant.runId, input.runId),
				isNull(participantToken.revokedAt),
			),
		);
	return rows.filter((r) => r.expiresAt > now);
}

// Silence unused imports — `lte` and `sql` aren't used in the current call set but kept
// imported for future expansion (e.g., expiring-token sweeps). Remove if oxlint flags.
void lte;
void sql;

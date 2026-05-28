// packages/database/drizzle/queries/outbound-webhook-credentials.ts
//
// CRUD over outbound_webhook_credential (Phase 11a step 3c). The crypto bits
// live in the sibling outbound-webhook-credential-crypto.ts file -- this module
// composes them with the DB layer.

import { and, eq, isNull } from "drizzle-orm";

import { db } from "../client";
import { outboundWebhookCredential } from "../schema/postgres";
import {
	encryptWebhookSigningSecret,
	generateWebhookSigningSecret,
	webhookSigningSecretLastFour,
} from "./outbound-webhook-credential-crypto";

// ---------------------------------------------------------------------------
// Reads -- never decrypts. The delivery worker (step 3c) will add a separate
// read path that decrypts inside its narrow scope. UI list/get returns the
// last-four for display.
// ---------------------------------------------------------------------------

export interface OutboundWebhookCredentialRow {
	id: string;
	organizationId: string;
	consumerProduct: string;
	endpointUrl: string;
	signingSecretLastFour: string | null;
	allowedReturnUrlPrefixes: string[];
	isActive: boolean;
	secretRotatedAt: Date;
	createdBy: string | null;
	createdAt: Date;
	updatedAt: Date;
}

function toUiRow(r: typeof outboundWebhookCredential.$inferSelect): OutboundWebhookCredentialRow {
	return {
		id: r.id,
		organizationId: r.organizationId,
		consumerProduct: r.consumerProduct,
		endpointUrl: r.endpointUrl,
		signingSecretLastFour: r.signingSecretLastFour,
		allowedReturnUrlPrefixes: r.allowedReturnUrlPrefixes,
		isActive: r.isActive,
		secretRotatedAt: r.secretRotatedAt,
		createdBy: r.createdBy,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
	};
}

/** List active (non-soft-deleted) credentials for an org. */
export async function listOutboundWebhookCredentialsForOrg(
	organizationId: string,
): Promise<OutboundWebhookCredentialRow[]> {
	const rows = await db
		.select()
		.from(outboundWebhookCredential)
		.where(
			and(
				eq(outboundWebhookCredential.organizationId, organizationId),
				isNull(outboundWebhookCredential.deletedAt),
			),
		);
	return rows.map(toUiRow);
}

/** Fetch one credential by id, scoped to the org. Returns null when not found
 * or soft-deleted. */
export async function getOutboundWebhookCredentialForOrg(
	organizationId: string,
	id: string,
): Promise<OutboundWebhookCredentialRow | null> {
	const row = await db.query.outboundWebhookCredential.findFirst({
		where: (c, { and: a, eq: e, isNull: n }) =>
			a(e(c.id, id), e(c.organizationId, organizationId), n(c.deletedAt)),
	});
	return row ? toUiRow(row) : null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateOutboundWebhookCredentialInput {
	organizationId: string;
	consumerProduct: string;
	endpointUrl: string;
	allowedReturnUrlPrefixes: string[];
	createdBy: string;
}

export interface CreateOutboundWebhookCredentialResult {
	credential: OutboundWebhookCredentialRow;
	/** Returned ONCE on creation -- the consumer (PM in v1) stores this and
	 * uses it to verify HMAC signatures on every inbound webhook delivery. We
	 * never surface the plaintext again; lost = rotate. */
	plaintextSecret: string;
}

export async function createOutboundWebhookCredential(
	input: CreateOutboundWebhookCredentialInput,
): Promise<CreateOutboundWebhookCredentialResult> {
	const plaintextSecret = generateWebhookSigningSecret();
	const encrypted = encryptWebhookSigningSecret(plaintextSecret);
	const lastFour = webhookSigningSecretLastFour(plaintextSecret);

	const [row] = await db
		.insert(outboundWebhookCredential)
		.values({
			organizationId: input.organizationId,
			consumerProduct: input.consumerProduct,
			endpointUrl: input.endpointUrl,
			signingSecretEncrypted: encrypted,
			signingSecretLastFour: lastFour,
			allowedReturnUrlPrefixes: input.allowedReturnUrlPrefixes,
			createdBy: input.createdBy,
		})
		.returning();

	return { credential: toUiRow(row), plaintextSecret };
}

export interface UpdateOutboundWebhookCredentialInput {
	id: string;
	organizationId: string;
	/** Partial update. Pass `undefined` to leave a field unchanged. Pass an
	 * empty array to clear allowedReturnUrlPrefixes (intentionally distinct from
	 * undefined). */
	endpointUrl?: string;
	allowedReturnUrlPrefixes?: string[];
	isActive?: boolean;
}

/** Update non-secret fields. Secret rotation is a separate procedure
 * (rotateOutboundWebhookCredentialSecret) because it has a one-time-reveal
 * return shape that differs from this no-secret-in-response shape. Returns
 * null if the row doesn't exist (caller maps to NOT_FOUND). */
export async function updateOutboundWebhookCredential(
	input: UpdateOutboundWebhookCredentialInput,
): Promise<OutboundWebhookCredentialRow | null> {
	const patch: Partial<typeof outboundWebhookCredential.$inferInsert> = {};
	if (input.endpointUrl !== undefined) patch.endpointUrl = input.endpointUrl;
	if (input.allowedReturnUrlPrefixes !== undefined) {
		patch.allowedReturnUrlPrefixes = input.allowedReturnUrlPrefixes;
	}
	if (input.isActive !== undefined) patch.isActive = input.isActive;
	if (Object.keys(patch).length === 0) {
		// No-op update; return the current state so the procedure layer can echo
		// back something useful to the UI without an extra read.
		return await getOutboundWebhookCredentialForOrg(input.organizationId, input.id);
	}
	const [row] = await db
		.update(outboundWebhookCredential)
		.set(patch)
		.where(
			and(
				eq(outboundWebhookCredential.id, input.id),
				eq(outboundWebhookCredential.organizationId, input.organizationId),
				isNull(outboundWebhookCredential.deletedAt),
			),
		)
		.returning();
	return row ? toUiRow(row) : null;
}

export interface RotateOutboundWebhookCredentialSecretInput {
	id: string;
	organizationId: string;
}

export interface RotateOutboundWebhookCredentialSecretResult {
	credential: OutboundWebhookCredentialRow;
	plaintextSecret: string;
}

/** Generate a new signing secret, encrypt + persist, update last-four +
 * secret_rotated_at. Returns the new plaintext ONCE. Returns null if the row
 * doesn't exist. */
export async function rotateOutboundWebhookCredentialSecret(
	input: RotateOutboundWebhookCredentialSecretInput,
): Promise<RotateOutboundWebhookCredentialSecretResult | null> {
	const plaintextSecret = generateWebhookSigningSecret();
	const encrypted = encryptWebhookSigningSecret(plaintextSecret);
	const lastFour = webhookSigningSecretLastFour(plaintextSecret);
	const [row] = await db
		.update(outboundWebhookCredential)
		.set({
			signingSecretEncrypted: encrypted,
			signingSecretLastFour: lastFour,
			secretRotatedAt: new Date(),
		})
		.where(
			and(
				eq(outboundWebhookCredential.id, input.id),
				eq(outboundWebhookCredential.organizationId, input.organizationId),
				isNull(outboundWebhookCredential.deletedAt),
			),
		)
		.returning();
	if (!row) return null;
	return { credential: toUiRow(row), plaintextSecret };
}

/** Soft-delete a credential. The partial unique index excludes soft-deleted
 * rows so re-registration of the same (org, consumer_product) immediately
 * after delete works without a unique-violation. */
export async function softDeleteOutboundWebhookCredential(
	organizationId: string,
	id: string,
): Promise<boolean> {
	const [row] = await db
		.update(outboundWebhookCredential)
		.set({ deletedAt: new Date(), isActive: false })
		.where(
			and(
				eq(outboundWebhookCredential.id, id),
				eq(outboundWebhookCredential.organizationId, organizationId),
				isNull(outboundWebhookCredential.deletedAt),
			),
		)
		.returning({ id: outboundWebhookCredential.id });
	return !!row;
}

// Re-export the crypto helpers so the delivery worker (Phase 11a step 3c) can
// import them via the package barrel without reaching into the crypto file's
// path directly.
export {
	decryptWebhookSigningSecret,
	encryptWebhookSigningSecret,
	generateWebhookSigningSecret,
	webhookSigningSecretLastFour,
} from "./outbound-webhook-credential-crypto";

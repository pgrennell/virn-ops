// packages/api/modules/runs/lib/guest.ts
//
// Tokenized guest access to a run (UX_SPEC §5.4, BUILD_PLAN.md Phase 3.5). A guest is a
// `participant` row with `userId IS NULL` and `guestEmail` set, who holds a verified
// `participant_token`. They reach `/run-guest/#token=<plaintext>` and can read + write
// ONLY the run steps they're assigned to.
//
// The security boundary lives in @virn/database: `getGuestRunBundle` returns ONLY the
// guest's assigned steps + their step-scoped fields + minimal run context (title, status,
// dates) + org name (for branding). It never includes other participants' identities,
// other runs, other steps, the kickoff fields, the workflow definition graph, or any
// org-level data. The narrowing is the boundary -- the database layer never even fetches
// the things the guest shouldn't see, so transport-layer bugs can't leak them.
//
// Writes reuse `completeRunStep` and `setRunFieldValue` from the same module, with a
// guest-shaped context (participantId set, userId undefined, isAdminOrOwner=false).
// Free win: the RUN_NOT_ACTIVE guard (D-016) applies to guests too -- a valid token
// can't mutate a completed run.

import {
	getActiveReturnUrlAllowlistForOrg,
	getGuestRunBundle,
	touchParticipantTokenUsage,
	verifyParticipantToken,
} from "@virn/database";

import { completeRunStep } from "./complete-step";
import { RunEngineError } from "./errors";
import { setRunFieldValue } from "./set-field-value";

/** D-037 returnUrl validator. Returns the candidate URL when it parses as
 * http(s) AND prefix-matches one of the org's active credential allowlist
 * entries; null otherwise. Keeping this pure (no DB I/O) means the
 * `getRunForGuest` path can do one allowlist read per request and reuse
 * the result for validation logic. */
export function validateGuestReturnUrl(
	candidate: string | null | undefined,
	allowlist: readonly string[],
): string | null {
	if (!candidate) return null;
	// Defense vs. javascript:, data:, etc. The credential procedure layer
	// already validates allowlist entries as http(s), but we re-check the
	// candidate here -- the request boundary is the second defense.
	let parsed: URL;
	try {
		parsed = new URL(candidate);
	} catch {
		return null;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
	for (const prefix of allowlist) {
		if (candidate.startsWith(prefix)) return candidate;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Hand-shaped return for getRunForGuest
// ---------------------------------------------------------------------------

export interface GuestField {
	key: string;
	label: string;
	fieldType: string;
	config: Record<string, unknown> | null;
	isRequired: boolean;
	value: unknown;
}

export interface GuestStep {
	runStepId: string;
	title: string;
	description: string | null;
	stepType: string;
	status: "pending" | "completed" | "skipped" | "not_applicable";
	dueAt: Date | null;
	blocked: boolean;
	canComplete: boolean;
	fields: GuestField[];
}

export interface GuestRunView {
	runId: string;
	runTitle: string;
	runStatus: "active" | "completed" | "archived";
	runStartedAt: Date;
	runDueAt: Date | null;
	organization: { name: string };
	participant: { guestEmail: string | null; guestName: string | null };
	steps: GuestStep[];
	/** D-037 link-out + return convention. Set to the validated returnUrl
	 * when the caller supplied one AND it matched the run's org allowlist;
	 * null otherwise. Frontend renders a "Return" affordance only when set. */
	returnUrl: string | null;
}

// ---------------------------------------------------------------------------
// getRunForGuest
// ---------------------------------------------------------------------------

/**
 * Verify the token, then assemble a narrowed view of the participant's run scope.
 *
 * Errors are intentionally undifferentiated: any failure (invalid token format, no match,
 * expired, revoked, participant detached from run, etc.) maps to a single
 * `GUEST_TOKEN_INVALID` -- callers map to FORBIDDEN. We don't tell the caller whether a
 * token "exists but is expired" vs "doesn't exist", to avoid confirming token validity.
 */
export async function getRunForGuest(
	token: string,
	candidateReturnUrl?: string | null,
): Promise<GuestRunView> {
	const verified = await verifyParticipantToken(token);
	if (!verified) {
		throw new RunEngineError("GUEST_TOKEN_INVALID", "This link isn't valid (or has expired).");
	}
	const { organizationId, participantId, participant: p, tokenId } = verified;

	// Touch lastUsedAt fire-and-forget; we don't block the request on it.
	void touchParticipantTokenUsage(tokenId);

	const bundle = await getGuestRunBundle({
		organizationId,
		participantId,
		runId: p.runId,
	});
	if (!bundle) {
		throw new RunEngineError("GUEST_TOKEN_INVALID", "This link isn't valid (or has expired).");
	}

	// D-037 returnUrl resolution. Only fire the allowlist read when the
	// caller actually passed a candidate -- saves a DB hit for the common
	// case (guest opens link directly, no PM-origin returnUrl).
	let returnUrl: string | null = null;
	if (candidateReturnUrl) {
		const allowlist = await getActiveReturnUrlAllowlistForOrg(organizationId);
		returnUrl = validateGuestReturnUrl(candidateReturnUrl, allowlist);
	}

	const runHeader = {
		runId: bundle.run.id,
		runTitle: bundle.run.title,
		runStatus: bundle.run.status,
		runStartedAt: bundle.run.startedAt,
		runDueAt: bundle.run.dueAt,
		organization: { name: bundle.run.orgName },
		participant: { guestEmail: p.guestEmail, guestName: p.guestName },
		returnUrl,
	};

	if (bundle.steps.length === 0) {
		// Token is valid, but the participant has no assigned steps on this run. Return
		// an empty view rather than an error so the guest sees a polite "nothing to do".
		return { ...runHeader, steps: [] };
	}

	// Index dependencies + dependee statuses for blocked computation.
	const depsByStepId = new Map<string, string[]>();
	for (const d of bundle.dependencies) {
		const arr = depsByStepId.get(d.stepId) ?? [];
		arr.push(d.dependsOnStepId);
		depsByStepId.set(d.stepId, arr);
	}
	const statusByDepStepId = new Map<string, string>();
	for (const s of bundle.dependeeStatuses) {
		if (s.stepId) statusByDepStepId.set(s.stepId, s.status);
	}

	// Group fields by their definition stepId for assembly.
	const fieldsByDefStepId = new Map<string, typeof bundle.fields>();
	for (const f of bundle.fields) {
		if (!f.stepId) continue;
		const arr = fieldsByDefStepId.get(f.stepId) ?? [];
		arr.push(f);
		fieldsByDefStepId.set(f.stepId, arr);
	}

	// Index field values by composite key.
	const valueByRunStepFieldId = new Map<string, unknown>();
	for (const v of bundle.values) {
		if (v.fieldId && v.runStepId) {
			valueByRunStepFieldId.set(`${v.runStepId}::${v.fieldId}`, v.value);
		}
	}

	const steps: GuestStep[] = bundle.steps.map((rs) => {
		const ownDeps = rs.stepId ? (depsByStepId.get(rs.stepId) ?? []) : [];
		const blocked = ownDeps.some((d) => statusByDepStepId.get(d) !== "completed");
		const stepFields = rs.stepId ? (fieldsByDefStepId.get(rs.stepId) ?? []) : [];
		const fields: GuestField[] = [...stepFields]
			.sort((a, b) => a.position - b.position)
			.map((f) => ({
				key: f.key,
				label: f.label,
				fieldType: f.fieldType,
				config: f.config,
				isRequired: f.isRequired,
				value: valueByRunStepFieldId.get(`${rs.id}::${f.id}`) ?? null,
			}));
		const requiredUnfilled = fields.some(
			(f) => f.isRequired && (f.value === null || f.value === undefined),
		);
		const canComplete = rs.status === "pending" && !blocked && !requiredUnfilled;
		return {
			runStepId: rs.id,
			title: rs.title,
			description: rs.description,
			// Guest UI doesn't need step-type distinction in v1; always task-shape.
			stepType: "task",
			status: rs.status,
			dueAt: rs.dueAt,
			blocked,
			canComplete,
			fields,
		};
	});

	return { ...runHeader, steps };
}

// ---------------------------------------------------------------------------
// Guest writes (delegate to the existing lib helpers with guest-shaped ctx)
// ---------------------------------------------------------------------------

/** Verify the token, then route through setRunFieldValue with a guest-shaped context. */
export async function setFieldValueAsGuest(input: {
	token: string;
	runStepId: string;
	fieldKey: string;
	value: unknown;
}): Promise<{ ok: true }> {
	const verified = await verifyParticipantToken(input.token);
	if (!verified) {
		throw new RunEngineError("GUEST_TOKEN_INVALID", "This link isn't valid (or has expired).");
	}
	void touchParticipantTokenUsage(verified.tokenId);
	return await setRunFieldValue(
		{
			organizationId: verified.organizationId,
			participantId: verified.participantId,
			isAdminOrOwner: false,
		},
		{
			runStepId: input.runStepId,
			fieldKey: input.fieldKey,
			value: input.value,
		},
	);
}

/** Verify the token, then route through completeRunStep with a guest-shaped context. */
export async function completeStepAsGuest(input: {
	token: string;
	runStepId: string;
}): Promise<{ runStepId: string; runCompleted: boolean }> {
	const verified = await verifyParticipantToken(input.token);
	if (!verified) {
		throw new RunEngineError("GUEST_TOKEN_INVALID", "This link isn't valid (or has expired).");
	}
	void touchParticipantTokenUsage(verified.tokenId);
	return await completeRunStep(
		{
			organizationId: verified.organizationId,
			participantId: verified.participantId,
			isAdminOrOwner: false,
		},
		input.runStepId,
	);
}

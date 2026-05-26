// packages/api/modules/workflows/lib/field-key.ts
//
// Field-key lifecycle (Invariant #5 + D-017): auto-slug from the friendly label, ensure
// uniqueness within the version, lock the moment any schema reference points at the
// field's id. The "key" is the stable identifier merge variables / conditions /
// due-rules / automations target; once those reference it, renaming would silently break
// them, so we refuse the rename.
//
// Today, the lock-check enumerates two schema reference surfaces:
//   - automation_condition.sourceFieldId  (show-when conditions)
//   - step.dueSourceFieldId               (date-field-driven due rules)
//
// The check is OPEN by design: when merge variables ship (text-template scanning of
// {{key}} references in step descriptions, comments, automation messages), extend
// `findFieldReferencers` in @virn/database -- this lib just trusts what it returns.

import slugify from "@sindresorhus/slugify";
import { findFieldByKey, findFieldReferencers } from "@virn/database";

import { WorkflowEngineError } from "./errors";

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const KEY_MAX_LENGTH = 64;

/** Validate a user-supplied key (post-slug or explicit). Rejects anything outside
 * `[a-z][a-z0-9_]*` and anything longer than 64 chars -- generous enough for descriptive
 * names, tight enough to remain a safe identifier in URLs, merge variables, and JSON paths. */
export function validateKeyShape(key: string): void {
	if (typeof key !== "string" || key.length === 0) {
		throw new WorkflowEngineError("FIELD_KEY_INVALID", "Field key cannot be empty.", { key });
	}
	if (key.length > KEY_MAX_LENGTH) {
		throw new WorkflowEngineError(
			"FIELD_KEY_INVALID",
			`Field key cannot exceed ${KEY_MAX_LENGTH} characters.`,
			{ key, maxLength: KEY_MAX_LENGTH },
		);
	}
	if (!KEY_PATTERN.test(key)) {
		throw new WorkflowEngineError(
			"FIELD_KEY_INVALID",
			"Field key must start with a lowercase letter and contain only lowercase letters, digits, and underscores.",
			{ key, pattern: KEY_PATTERN.source },
		);
	}
}

/** Auto-slug a friendly label into a candidate key. Empty / non-leading-alpha labels
 * fall back to "field" so the user always gets something to edit. */
export function autoSlugFromLabel(label: string): string {
	const base = slugify(label, { separator: "_", lowercase: true });
	const trimmed = base.slice(0, KEY_MAX_LENGTH);
	if (trimmed.length === 0) return "field";
	// Ensure it starts with a letter (slugify can produce digit-leading strings if the
	// label starts with a number). Prefix with `f_` if so.
	if (!/^[a-z]/.test(trimmed)) {
		return `f_${trimmed}`.slice(0, KEY_MAX_LENGTH);
	}
	return trimmed;
}

/** Resolve a unique key within a version: if `candidate` is free, return it; otherwise
 * append `_2`, `_3`, ... until a free slot is found. Caller passes
 * `excludeFieldId` to skip the row being renamed (so a rename-to-same is a no-op). */
export async function resolveUniqueKey(input: {
	workflowVersionId: string;
	candidate: string;
	excludeFieldId?: string;
}): Promise<string> {
	validateKeyShape(input.candidate);
	const conflict = await findFieldByKey(
		input.workflowVersionId,
		input.candidate,
		input.excludeFieldId,
	);
	if (!conflict) return input.candidate;

	// Try suffixed variants until one fits.
	for (let i = 2; i < 1000; i++) {
		const next = `${input.candidate}_${i}`.slice(0, KEY_MAX_LENGTH);
		const c = await findFieldByKey(input.workflowVersionId, next, input.excludeFieldId);
		if (!c) return next;
	}
	// Defensive: if we somehow can't resolve in 1000 attempts, the version has 1000+
	// fields with similar keys -- prefer an explicit error over an infinite loop.
	throw new WorkflowEngineError(
		"FIELD_KEY_CONFLICT",
		`Could not resolve a unique key from "${input.candidate}" -- too many collisions.`,
		{ candidate: input.candidate },
	);
}

/** Refuse the rename if the field is referenced by any schema reference (D-017). Returns
 * the referencer list in the error details so the UI can render "Clear these first." */
export async function assertKeyRenameAllowed(fieldId: string): Promise<void> {
	const refs = await findFieldReferencers(fieldId);
	if (refs.length > 0) {
		throw new WorkflowEngineError(
			"FIELD_KEY_LOCKED",
			`This field's key is referenced by ${refs.length} item(s) and cannot be renamed. Clear the references first.`,
			{ fieldId, referencers: refs },
		);
	}
}

/** Same as `assertKeyRenameAllowed` but framed for delete. Same probe; different message
 * so the UI can distinguish the two refusal flows. Currently identical because the only
 * "references" today are schema references; when merge-variable scanning lands, both
 * will pick up the same expanded reference set. */
export async function assertFieldDeleteAllowed(fieldId: string): Promise<void> {
	const refs = await findFieldReferencers(fieldId);
	if (refs.length > 0) {
		throw new WorkflowEngineError(
			"FIELD_HAS_REFERENCERS",
			`This field is referenced by ${refs.length} item(s) and cannot be deleted. Clear the references first.`,
			{ fieldId, referencers: refs },
		);
	}
}

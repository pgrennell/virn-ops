// apps/saas/modules/library/lib/launcher-validation.ts
//
// Pure-function client-side validation of the Launcher's kickoff form. Returns the
// list of required-but-missing kickoff field keys so the form can disable Submit +
// surface inline indicators per field.
//
// CONVENIENCE ONLY. The server is the source of truth (integrity #2): the launcher's
// submit handler ALWAYS catches REQUIRED_KICKOFF_FIELD_MISSING from runs.launch and
// surfaces it inline. Client validation just prevents the obvious submit-with-empty
// roundtrip; the server's typed refusal is what guarantees correctness.

export interface KickoffFieldDescriptor {
	/** field.key (stable identifier per Invariant #5). Used as the cache key for the
	 * client-side value map AND as the property name in the kickoffValues payload
	 * passed to runs.launch. */
	key: string;
	label: string;
	isRequired: boolean;
}

/** Treat empty string and null/undefined as "missing" for required-field purposes.
 * launchRun's REQUIRED_KICKOFF_FIELD_MISSING refusal fires when the key is absent
 * from the kickoffValues map; mirroring the same semantics client-side prevents the
 * "I typed nothing" submit-then-bounce loop. */
function isMissing(value: unknown): boolean {
	if (value === null || value === undefined) return true;
	if (typeof value === "string" && value.trim().length === 0) return true;
	// Arrays (multiselect) count as missing when empty.
	if (Array.isArray(value) && value.length === 0) return true;
	return false;
}

/** Returns the list of required kickoff field keys that are missing a value. Empty
 * array = all required fields are filled (client-side); submit is allowed. */
export function findMissingRequiredKickoffFields(
	fields: readonly KickoffFieldDescriptor[],
	values: ReadonlyMap<string, unknown> | Record<string, unknown>,
): string[] {
	const valueOf = (key: string): unknown => {
		if (values instanceof Map) return values.get(key);
		return (values as Record<string, unknown>)[key];
	};

	const missing: string[] = [];
	for (const f of fields) {
		if (!f.isRequired) continue;
		if (isMissing(valueOf(f.key))) {
			missing.push(f.key);
		}
	}
	return missing;
}

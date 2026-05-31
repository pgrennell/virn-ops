// packages/database/drizzle/queries/_pure/field-validation.ts
//
// Client-free field-value validation, extracted from queries/runs.ts per D-046 so it
// can be unit-tested without initialising the drizzle client (importing runs.ts pulls
// `db` from ../client, which needs DATABASE_URL). This module imports ONLY zod at
// runtime -- `FieldType` is a type-only import (erased under isolatedModules), so a deep
// import of this file never touches the client. queries/runs.ts re-exports
// `validateFieldValue` for back-compat; every existing import site is unchanged.

import { z } from "zod";

import type { FieldType } from "../runs";

/** Build a Zod schema from a field's fieldType + config, then parse `value`. Throws
 * ZodError on failure. */
export function validateFieldValue(
	fieldRow: { fieldType: FieldType; config: Record<string, unknown> | null; isRequired: boolean },
	value: unknown,
): unknown {
	// If the value is null/undefined, treat as "unset". Caller decides whether absence is
	// allowed (completeStep checks isRequired on its own).
	if (value === null || value === undefined) return value;
	const cfg = fieldRow.config ?? {};
	const schema = buildFieldZod(fieldRow.fieldType, cfg);
	return schema.parse(value);
}

function buildFieldZod(type: FieldType, cfg: Record<string, unknown>): z.ZodTypeAny {
	switch (type) {
		case "text": {
			let s = z.string();
			if (typeof cfg.minLength === "number") s = s.min(cfg.minLength);
			if (typeof cfg.maxLength === "number") s = s.max(cfg.maxLength);
			if (typeof cfg.pattern === "string") s = s.regex(new RegExp(cfg.pattern));
			return s;
		}
		case "textarea": {
			let s = z.string();
			if (typeof cfg.maxLength === "number") s = s.max(cfg.maxLength);
			return s;
		}
		case "number": {
			let n = z.number();
			if (typeof cfg.min === "number") n = n.min(cfg.min);
			if (typeof cfg.max === "number") n = n.max(cfg.max);
			if (cfg.int === true) n = n.int();
			return n;
		}
		case "date":
			// Accept ISO 8601 string; downstream serializes to TIMESTAMPTZ.
			return z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), {
				message: "must be a valid ISO 8601 date string",
			});
		case "select": {
			const options = Array.isArray(cfg.options) ? (cfg.options as string[]) : [];
			return options.length > 0 ? z.enum(options as [string, ...string[]]) : z.string();
		}
		case "multiselect": {
			const options = Array.isArray(cfg.options) ? (cfg.options as string[]) : [];
			return options.length > 0
				? z.array(z.enum(options as [string, ...string[]]))
				: z.array(z.string());
		}
		case "file":
		case "image":
		case "signature":
			// Storage references -- the actual upload pipeline writes the object key here.
			return z.object({
				key: z.string().min(1),
				size: z.number().int().nonnegative().optional(),
				contentType: z.string().optional(),
			});
		case "member":
			// userId reference; existence is validated separately if/when needed.
			return z.string().min(1);
		case "lookup":
			// Reserved -- data_set integration deferred per BUILD_PLAN.md Batch 7.
			return z.unknown();
		default: {
			const exhaustive: never = type;
			throw new Error(`Unknown field type: ${String(exhaustive)}`);
		}
	}
}

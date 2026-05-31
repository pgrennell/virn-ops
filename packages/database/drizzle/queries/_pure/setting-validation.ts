// packages/database/drizzle/queries/_pure/setting-validation.ts
//
// Client-free setting-value validation, extracted from queries/config.ts per D-046 so it
// can be unit-tested without initialising the drizzle client. Pure zod logic: build a
// schema from a setting definition's dataType + validationSchema, then parse. Imports
// only zod at runtime (SettingDataType + EffectiveSetting are type-only imports, erased
// under isolatedModules). queries/config.ts imports validateSettingValue from here (it
// uses it internally) and re-exports it for back-compat -- every import site unchanged.

import { z } from "zod";

import type { EffectiveSetting, SettingDataType } from "../config";

type ValidationSchemaShape = Record<string, unknown> | null;

const VALIDATION_BUILDERS: Record<SettingDataType, (schema: ValidationSchemaShape) => z.ZodTypeAny> =
	{
		string: (s) => {
			let z_ = z.string();
			if (typeof s?.minLength === "number") z_ = z_.min(s.minLength);
			if (typeof s?.maxLength === "number") z_ = z_.max(s.maxLength);
			if (typeof s?.pattern === "string") z_ = z_.regex(new RegExp(s.pattern));
			return z_;
		},
		number: (s) => {
			let z_ = z.number();
			if (typeof s?.min === "number") z_ = z_.min(s.min);
			if (typeof s?.max === "number") z_ = z_.max(s.max);
			if (s?.int === true) z_ = z_.int();
			return z_;
		},
		boolean: () => z.boolean(),
		json: () => z.unknown(),
		select: (s) =>
			Array.isArray(s?.options) && s.options.length > 0
				? z.enum(s.options as [string, ...string[]])
				: z.string(),
		multiselect: (s) =>
			Array.isArray(s?.options) && s.options.length > 0
				? z.array(z.enum(s.options as [string, ...string[]]))
				: z.array(z.string()),
	};

/** Validate a value against a setting definition. Returns the parsed value or throws
 * `ZodError`. */
export function validateSettingValue(
	definition: Pick<EffectiveSetting, "dataType" | "validationSchema">,
	value: unknown,
): unknown {
	const builder = VALIDATION_BUILDERS[definition.dataType];
	if (!builder) {
		throw new Error(`Unknown setting dataType: ${definition.dataType}`);
	}
	return builder(definition.validationSchema).parse(value);
}

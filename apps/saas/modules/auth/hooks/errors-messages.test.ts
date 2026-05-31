// @vitest-environment jsdom
//
// First HOOK test under the new harness (@testing-library/react renderHook). Proves the
// renderHook API + the provider-mocking pattern future hook tests reuse: next-intl's
// useTranslations is mocked to echo the key, so we can assert the error-code -> i18n-key
// mapping + the unknown-error fallback without a real NextIntlClientProvider.

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
	// Echo the translation key so the hook's mapping is observable.
	useTranslations: () => (key: string) => key,
}));

import { useAuthErrorMessages } from "./errors-messages";

describe("useAuthErrorMessages", () => {
	it("maps a known auth error code to its i18n key", () => {
		const { result } = renderHook(() => useAuthErrorMessages());
		expect(result.current.getAuthErrorMessage("USER_NOT_FOUND")).toBe("auth.errors.userNotFound");
		expect(result.current.getAuthErrorMessage("INVALID_EMAIL_OR_PASSWORD")).toBe(
			"auth.errors.invalidEmailOrPassword",
		);
	});

	it("falls back to the unknown-error message for an unrecognised or missing code", () => {
		const { result } = renderHook(() => useAuthErrorMessages());
		expect(result.current.getAuthErrorMessage("SOMETHING_NOT_IN_THE_MAP")).toBe("auth.errors.unknown");
		expect(result.current.getAuthErrorMessage(undefined)).toBe("auth.errors.unknown");
	});
});

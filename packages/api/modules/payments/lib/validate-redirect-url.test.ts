// Unit tests for the same-origin redirect-URL guard (open-redirect prevention per
// AUTH_CONTRACT.md ?7). Pure logic over NEXT_PUBLIC_SAAS_URL: relative paths pass, absolute
// same-origin URLs pass, and everything else (cross-origin, protocol-relative, garbage)
// throws ORPCError BAD_REQUEST.

import { ORPCError } from "@orpc/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertSameOriginRedirect } from "./validate-redirect-url";

const ORIGINAL = process.env.NEXT_PUBLIC_SAAS_URL;

beforeEach(() => {
	process.env.NEXT_PUBLIC_SAAS_URL = "https://app.example.com";
});

afterEach(() => {
	process.env.NEXT_PUBLIC_SAAS_URL = ORIGINAL;
});

describe("assertSameOriginRedirect", () => {
	it("allows undefined (no redirect requested)", () => {
		expect(() => assertSameOriginRedirect(undefined)).not.toThrow();
	});

	it("allows relative paths", () => {
		expect(() => assertSameOriginRedirect("/dashboard")).not.toThrow();
		expect(() => assertSameOriginRedirect("/billing?status=ok")).not.toThrow();
	});

	it("allows absolute URLs on the configured app origin", () => {
		expect(() => assertSameOriginRedirect("https://app.example.com/checkout")).not.toThrow();
		expect(() => assertSameOriginRedirect("https://app.example.com")).not.toThrow();
	});

	it("rejects a protocol-relative URL (off-host)", () => {
		expect(() => assertSameOriginRedirect("//evil.com/phish")).toThrowError(ORPCError);
	});

	it("rejects a cross-origin absolute URL", () => {
		expect(() => assertSameOriginRedirect("https://evil.com/phish")).toThrowError(ORPCError);
	});

	it("rejects a same-host URL on a different scheme/port (different origin)", () => {
		expect(() => assertSameOriginRedirect("http://app.example.com/x")).toThrowError(ORPCError);
		expect(() => assertSameOriginRedirect("https://app.example.com:8443/x")).toThrowError(
			ORPCError,
		);
	});

	it("rejects unparseable input", () => {
		expect(() => assertSameOriginRedirect("not a url")).toThrowError(ORPCError);
	});

	it("throws BAD_REQUEST specifically", () => {
		try {
			assertSameOriginRedirect("https://evil.com");
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(ORPCError);
			expect((err as ORPCError<string, unknown>).code).toBe("BAD_REQUEST");
		}
	});
});

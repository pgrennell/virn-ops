// @vitest-environment jsdom
//
// useMediaQuery / useIsMobile -- read window.matchMedia and track changes. jsdom has no
// matchMedia, so we stub it with a controllable matches value + a listener registry, then
// assert the hook returns the initial match, that useIsMobile asks for the md breakpoint, and
// that a "change" event updates the returned value.

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useIsMobile, useMediaQuery } from "./use-media-query";

let changeHandler: ((e: { matches: boolean }) => void) | null = null;

function stubMatchMedia(initialMatches: boolean) {
	let matches = initialMatches;
	vi.stubGlobal("matchMedia", (query: string) => ({
		get matches() {
			return matches;
		},
		media: query,
		addEventListener: (_event: string, cb: (e: { matches: boolean }) => void) => {
			changeHandler = cb;
		},
		removeEventListener: () => {
			changeHandler = null;
		},
	}));
	return {
		emitChange: (next: boolean) => {
			matches = next;
			changeHandler?.({ matches: next });
		},
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
	changeHandler = null;
});

describe("useMediaQuery", () => {
	it("returns the current match for the query", () => {
		stubMatchMedia(true);
		const { result } = renderHook(() => useMediaQuery("(max-width: 600px)"));
		expect(result.current).toBe(true);
	});

	it("returns false when the query does not match", () => {
		stubMatchMedia(false);
		const { result } = renderHook(() => useMediaQuery("(max-width: 600px)"));
		expect(result.current).toBe(false);
	});

	it("updates when a change event fires", () => {
		const mq = stubMatchMedia(false);
		const { result } = renderHook(() => useMediaQuery("(max-width: 600px)"));
		expect(result.current).toBe(false);
		act(() => mq.emitChange(true));
		expect(result.current).toBe(true);
	});
});

describe("useIsMobile", () => {
	it("matches the mobile breakpoint", () => {
		const calls: string[] = [];
		vi.stubGlobal("matchMedia", (query: string) => {
			calls.push(query);
			return {
				matches: true,
				media: query,
				addEventListener: () => {},
				removeEventListener: () => {},
			};
		});
		const { result } = renderHook(() => useIsMobile());
		expect(result.current).toBe(true);
		expect(calls).toContain("(max-width: 767px)");
	});
});

// @vitest-environment jsdom
//
// ConsentBanner -- a client banner gated on a cookie-consent context. Three behaviours:
// it stays hidden once the user has consented, it renders the Allow/Decline pair when they
// haven't, and the buttons call the context's allow/decline. We mock the cookie-consent
// hook (the only seam) so we can drive consent state + spy the callbacks. The component
// also self-gates on a mounted useEffect; render() flushes effects so the banner appears.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const allowCookies = vi.fn();
const declineCookies = vi.fn();
let userHasConsented = false;

vi.mock("@shared/hooks/cookie-consent", () => ({
	useCookieConsent: () => ({ userHasConsented, allowCookies, declineCookies }),
}));

import { ConsentBanner } from "./ConsentBanner";

afterEach(() => {
	cleanup();
	allowCookies.mockClear();
	declineCookies.mockClear();
	userHasConsented = false;
});

describe("ConsentBanner", () => {
	it("renders the Allow/Decline pair when the user has not consented", () => {
		render(<ConsentBanner />);
		expect(screen.getByRole("button", { name: /allow/i })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /decline/i })).toBeInTheDocument();
	});

	it("calls allowCookies / declineCookies when the buttons are clicked", () => {
		render(<ConsentBanner />);
		fireEvent.click(screen.getByRole("button", { name: /allow/i }));
		expect(allowCookies).toHaveBeenCalledOnce();
		fireEvent.click(screen.getByRole("button", { name: /decline/i }));
		expect(declineCookies).toHaveBeenCalledOnce();
	});

	it("renders nothing once the user has consented", () => {
		userHasConsented = true;
		const { container } = render(<ConsentBanner />);
		expect(container).toBeEmptyDOMElement();
	});
});

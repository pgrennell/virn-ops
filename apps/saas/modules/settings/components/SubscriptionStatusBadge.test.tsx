// @vitest-environment jsdom
//
// SubscriptionStatusBadge -- maps a subscription status string to a localized label. We mock
// next-intl so useTranslations echoes the key, letting us assert the exact label key each
// status resolves to (every entry in the status table). One mock (next-intl).

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

import { SubscriptionStatusBadge } from "./SubscriptionStatusBadge";

afterEach(cleanup);

const STATUSES = [
	"active",
	"canceled",
	"expired",
	"incomplete",
	"past_due",
	"paused",
	"trialing",
	"unpaid",
] as const;

describe("SubscriptionStatusBadge", () => {
	it.each(STATUSES)("renders the localized label for the %s status", (status) => {
		render(<SubscriptionStatusBadge status={status} />);
		expect(
			screen.getByText(`settings.billing.activePlan.status.${status}`),
		).toBeInTheDocument();
	});
});

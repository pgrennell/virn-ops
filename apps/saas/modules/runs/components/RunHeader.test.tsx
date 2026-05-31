// @vitest-environment jsdom
//
// RunHeader -- the run detail header. Pure (Progress + cn + lucide + derive-run-mode
// constants). Branches worth pinning: the status badge label, the progress percentage (and
// the totalCount==0 guard), the mode badge (shown only for non-human modes), the vendor chip
// (singular/plural, hidden at zero), and the agent chip (only when count>0 AND mode is human).

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RUN_MODE_LABEL } from "../lib/derive-run-mode";
import { RunHeader } from "./RunHeader";

afterEach(cleanup);

const BASE = {
	title: "Turnover #12",
	status: "active" as const,
	completedCount: 1,
	totalCount: 4,
	startedAt: new Date(2026, 5, 1),
	dueAt: null,
};

describe("RunHeader status + progress", () => {
	it.each([
		["active", "Active"],
		["completed", "Completed"],
		["archived", "Archived"],
	] as const)("shows the %s status badge", (status, label) => {
		render(<RunHeader {...BASE} status={status} />);
		expect(screen.getByText(label)).toBeInTheDocument();
	});

	it("renders the step progress count", () => {
		render(<RunHeader {...BASE} completedCount={1} totalCount={4} />);
		expect(screen.getByText("1 of 4 steps")).toBeInTheDocument();
	});

	it("guards against a zero total (no divide-by-zero)", () => {
		render(<RunHeader {...BASE} completedCount={0} totalCount={0} />);
		expect(screen.getByText("0 of 0 steps")).toBeInTheDocument();
	});
});

describe("RunHeader mode badge", () => {
	it("shows the mode badge for a non-human mode", () => {
		render(<RunHeader {...BASE} mode="ai_assisted" />);
		expect(screen.getByText(RUN_MODE_LABEL.ai_assisted)).toBeInTheDocument();
	});

	it("hides the mode badge for human mode", () => {
		render(<RunHeader {...BASE} mode="human" />);
		expect(screen.queryByText(RUN_MODE_LABEL.ai_assisted)).not.toBeInTheDocument();
		expect(screen.queryByText(RUN_MODE_LABEL.automated)).not.toBeInTheDocument();
	});
});

describe("RunHeader participant chips", () => {
	it("shows a singular vendor chip for one vendor", () => {
		render(<RunHeader {...BASE} vendorParticipantCount={1} />);
		expect(screen.getByText(/1 vendor$/)).toBeInTheDocument();
	});

	it("shows a plural vendor chip for several vendors", () => {
		render(<RunHeader {...BASE} vendorParticipantCount={3} />);
		expect(screen.getByText(/3 vendors/)).toBeInTheDocument();
	});

	it("renders no vendor chip at zero", () => {
		render(<RunHeader {...BASE} vendorParticipantCount={0} />);
		expect(screen.queryByText(/vendor/)).not.toBeInTheDocument();
	});

	it("shows the agent chip only when count>0 and the run is human mode", () => {
		const { rerender } = render(
			<RunHeader {...BASE} mode="human" agentParticipantCount={2} />,
		);
		expect(screen.getByTitle(/2 agent participants on this run/i)).toBeInTheDocument();

		// Same count but a non-human mode: the chip is suppressed (the mode badge conveys it).
		rerender(<RunHeader {...BASE} mode="ai_assisted" agentParticipantCount={2} />);
		expect(screen.queryByTitle(/agent participants on this run/i)).not.toBeInTheDocument();
	});
});

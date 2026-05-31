// @vitest-environment jsdom
//
// LaunchModePicker -- the S-07 wedge mode picker (Human / AI-assisted / Automated). The
// behaviour worth pinning is the disable semantics (UX_SPEC ?2: "show disabled WITH a reason,
// never hide"): human is always enabled; the agent modes disable (with copy) when the org has
// no ACTIVE agents; ai_assisted additionally disables when the workflow has no AI-shaped steps.
//
// The agent list comes from a useQuery; we override just useQuery (importActual keeps orpc's
// tanstack integration intact) to drive it, and render with mode="human" so the agent picker
// Select (radix portal) stays closed -- this test is about the cards, not the picker.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let agentsData: Array<{ id: string; name: string; isActive: boolean }> = [];

vi.mock("@tanstack/react-query", async (orig) => ({
	...(await orig<typeof import("@tanstack/react-query")>()),
	useQuery: () => ({ data: agentsData }),
}));

import { LaunchModePicker } from "./LaunchModePicker";

afterEach(() => {
	cleanup();
	agentsData = [];
});

const AI_STEPS = [{ id: "s1", title: "Draft summary", type: "ai", position: 0 }];
const HUMAN_STEPS = [{ id: "s1", title: "Inspect", type: "task", position: 0 }];

function renderPicker(steps: typeof AI_STEPS | typeof HUMAN_STEPS) {
	return render(
		<LaunchModePicker
			mode="human"
			onChangeMode={() => {}}
			selectedAgentId={null}
			onChangeAgentId={() => {}}
			steps={steps}
		/>,
	);
}

const card = (name: RegExp) => screen.getByRole("button", { name });

describe("LaunchModePicker disable semantics", () => {
	it("disables both agent modes with a reason when there are no active agents", () => {
		agentsData = [];
		renderPicker(AI_STEPS);
		expect(card(/^Human/)).not.toBeDisabled();
		expect(card(/AI-assisted/)).toBeDisabled();
		expect(card(/Automated/)).toBeDisabled();
		expect(screen.getAllByText(/no active agents in this org/i).length).toBeGreaterThan(0);
	});

	it("treats an org with only inactive agents as having no active agents", () => {
		agentsData = [{ id: "a1", name: "Turnover AI", isActive: false }];
		renderPicker(AI_STEPS);
		expect(card(/AI-assisted/)).toBeDisabled();
		expect(card(/Automated/)).toBeDisabled();
	});

	it("enables all three modes when there are active agents and AI steps", () => {
		agentsData = [{ id: "a1", name: "Turnover AI", isActive: true }];
		renderPicker(AI_STEPS);
		expect(card(/^Human/)).not.toBeDisabled();
		expect(card(/AI-assisted/)).not.toBeDisabled();
		expect(card(/Automated/)).not.toBeDisabled();
	});

	it("disables only ai_assisted (with the no-AI-steps reason) when the workflow has no AI steps", () => {
		agentsData = [{ id: "a1", name: "Turnover AI", isActive: true }];
		renderPicker(HUMAN_STEPS);
		expect(card(/AI-assisted/)).toBeDisabled();
		expect(card(/Automated/)).not.toBeDisabled();
		expect(screen.getByText(/no ai-shaped steps/i)).toBeInTheDocument();
	});
});

// @vitest-environment jsdom
//
// MyTaskRow -- one row in My Work. Pure (cn + Spinner + lucide), so no providers. Three
// behaviour clusters worth pinning:
//   1. The left affordance state machine -- spinner while completing, check when completed,
//      lock when blocked, empty square otherwise -- surfaced through the button's aria-label,
//      plus the can-quick-complete disabled gate (completed/blocked/in-flight all disable it).
//   2. The callbacks -- the checkbox quick-completes only when enabled; the body opens the run.
//   3. The relative due chip (Today/Tomorrow/Yesterday/+Nd/-Nd/absolute) -- driven off "now",
//      so we pin the clock with fake timers to keep the day math deterministic.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MyTaskRow, type MyTaskRowData } from "./MyTaskRow";

const NOW = new Date(2026, 5, 15, 12, 0, 0); // 2026-06-15, local noon

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

function makeTask(overrides: Partial<MyTaskRowData> = {}): MyTaskRowData {
	return {
		runStepId: "rs-1",
		stepTitle: "Inspect the unit",
		status: "pending",
		blocked: false,
		dueAt: null,
		runId: "run-1",
		runTitle: "Turnover #12",
		workflowTitle: "Make-ready",
		...overrides,
	};
}

function renderRow(props: Partial<Parameters<typeof MyTaskRow>[0]> = {}) {
	return render(
		<MyTaskRow
			task={props.task ?? makeTask()}
			completing={props.completing ?? false}
			onQuickComplete={props.onQuickComplete ?? (() => {})}
			onOpen={props.onOpen ?? (() => {})}
		/>,
	);
}

const checkbox = () => screen.getByRole("button", { name: /mark complete|completed|blocked/i });

describe("MyTaskRow affordance state + gating", () => {
	it("labels the action 'Mark complete' and enables it for an open task", () => {
		renderRow();
		expect(checkbox()).toHaveAccessibleName("Mark complete");
		expect(checkbox()).not.toBeDisabled();
	});

	it("labels and disables the action for a completed task", () => {
		renderRow({ task: makeTask({ status: "completed" }) });
		expect(checkbox()).toHaveAccessibleName("Completed");
		expect(checkbox()).toBeDisabled();
	});

	it("labels and disables the action for a blocked task", () => {
		renderRow({ task: makeTask({ blocked: true }) });
		expect(checkbox()).toHaveAccessibleName("Blocked");
		expect(checkbox()).toBeDisabled();
	});

	it("disables the action while a completion is in flight", () => {
		renderRow({ completing: true });
		expect(checkbox()).toBeDisabled();
	});
});

describe("MyTaskRow callbacks", () => {
	it("quick-completes when the enabled checkbox is clicked", () => {
		const onQuickComplete = vi.fn();
		renderRow({ onQuickComplete });
		fireEvent.click(checkbox());
		expect(onQuickComplete).toHaveBeenCalledOnce();
	});

	it("does not quick-complete when the checkbox is disabled (blocked)", () => {
		const onQuickComplete = vi.fn();
		renderRow({ task: makeTask({ blocked: true }), onQuickComplete });
		fireEvent.click(checkbox());
		expect(onQuickComplete).not.toHaveBeenCalled();
	});

	it("opens the run when the row body is clicked", () => {
		const onOpen = vi.fn();
		renderRow({ onOpen });
		fireEvent.click(screen.getByRole("button", { name: /inspect the unit/i }));
		expect(onOpen).toHaveBeenCalledOnce();
	});
});

describe("MyTaskRow due chip", () => {
	it.each([
		[new Date(2026, 5, 15), "Today"],
		[new Date(2026, 5, 16), "Tomorrow"],
		[new Date(2026, 5, 14), "Yesterday"],
		[new Date(2026, 5, 18), "+3d"],
		[new Date(2026, 5, 12), "-3d"],
	])("renders the relative chip %s -> %s", (dueAt, expected) => {
		renderRow({ task: makeTask({ dueAt }) });
		expect(screen.getByText(expected)).toBeInTheDocument();
	});

	it("falls back to an absolute date beyond a week out", () => {
		renderRow({ task: makeTask({ dueAt: new Date(2026, 6, 20) }) });
		// Month name is locale-dependent; the numeric day is stable.
		expect(screen.getByText(/20/)).toBeInTheDocument();
	});

	it("renders no chip when there is no due date", () => {
		renderRow({ task: makeTask({ dueAt: null }) });
		for (const label of ["Today", "Tomorrow", "Yesterday"]) {
			expect(screen.queryByText(label)).not.toBeInTheDocument();
		}
	});
});

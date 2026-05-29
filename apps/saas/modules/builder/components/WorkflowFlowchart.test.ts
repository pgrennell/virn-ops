// Phase 10 / v1.5c (PRD §6.4 / R5 lift) -- layout-pure unit tests for the
// Read view flowchart. The rendered component is exercised end-to-end in
// the Antigravity verification spec; these tests pin the determinism
// promise: same inputs -> same nodes + edges, no randomness.

import { describe, expect, it } from "vitest";

import {
	computeFlowchartLayout,
	type FlowchartSection,
	type FlowchartStep,
} from "./WorkflowFlowchart";

const SECTIONS: FlowchartSection[] = [
	{ id: "sec_a", title: "Prep", position: 0 },
	{ id: "sec_b", title: "Execution", position: 1 },
];

const STEPS: FlowchartStep[] = [
	{
		id: "stp_1",
		title: "Schedule walkthrough",
		type: "task",
		position: 0,
		sectionId: "sec_a",
		isRequired: true,
		isStopTask: false,
	},
	{
		id: "stp_2",
		title: "Send reminder",
		type: "task",
		position: 1,
		sectionId: "sec_a",
		isRequired: false,
		isStopTask: false,
	},
	{
		id: "stp_3",
		title: "Manager approval",
		type: "approval",
		position: 0,
		sectionId: "sec_b",
		isRequired: true,
		isStopTask: true,
	},
];

describe("computeFlowchartLayout -- structure", () => {
	it("emits one section header + one node per step", () => {
		const { nodes } = computeFlowchartLayout(SECTIONS, STEPS);
		const sectionNodes = nodes.filter((n) => n.type === "sectionHeader");
		const stepNodes = nodes.filter((n) => n.type === "step");
		expect(sectionNodes).toHaveLength(2);
		expect(stepNodes).toHaveLength(3);
	});

	it("threads consecutive edges within a section but not across sections", () => {
		const { edges } = computeFlowchartLayout(SECTIONS, STEPS);
		// stp_1 -> stp_2 (same section), then nothing crossing to stp_3.
		expect(edges).toHaveLength(1);
		expect(edges[0].source).toBe("step_stp_1");
		expect(edges[0].target).toBe("step_stp_2");
	});

	it("renders sections in position order (not insertion order)", () => {
		const reversed = [...SECTIONS].reverse();
		const { nodes } = computeFlowchartLayout(reversed, STEPS);
		const sectionTitles = nodes
			.filter((n) => n.type === "sectionHeader")
			.map((n) => {
				const data = n.data as { kind: "section"; title: string };
				return data.title;
			});
		expect(sectionTitles).toEqual(["Prep", "Execution"]);
	});

	it("renders steps in position order within a section", () => {
		const shuffled = [STEPS[1], STEPS[0], STEPS[2]];
		const { nodes } = computeFlowchartLayout(SECTIONS, shuffled);
		const stepIds = nodes
			.filter((n) => n.type === "step")
			.map((n) => (n.data as { kind: "step"; stepId: string }).stepId);
		expect(stepIds).toEqual(["stp_1", "stp_2", "stp_3"]);
	});
});

describe("computeFlowchartLayout -- determinism", () => {
	it("returns identical output for identical input", () => {
		const a = computeFlowchartLayout(SECTIONS, STEPS);
		const b = computeFlowchartLayout(SECTIONS, STEPS);
		expect(a.nodes.map((n) => n.position)).toEqual(b.nodes.map((n) => n.position));
		expect(a.edges).toEqual(b.edges);
	});
});

describe("computeFlowchartLayout -- ungrouped steps", () => {
	it("renders ungrouped steps with no section header when no sections exist", () => {
		const ungroupedOnly: FlowchartStep[] = [
			{
				id: "stp_x",
				title: "Standalone",
				type: "task",
				position: 0,
				sectionId: null,
				isRequired: true,
				isStopTask: false,
			},
		];
		const { nodes } = computeFlowchartLayout([], ungroupedOnly);
		expect(nodes.filter((n) => n.type === "sectionHeader")).toHaveLength(0);
		expect(nodes.filter((n) => n.type === "step")).toHaveLength(1);
	});

	it("labels ungrouped tail \"Other steps\" when sections also exist", () => {
		const mixed: FlowchartStep[] = [
			...STEPS,
			{
				id: "stp_tail",
				title: "Orphan",
				type: "task",
				position: 0,
				sectionId: null,
				isRequired: true,
				isStopTask: false,
			},
		];
		const { nodes } = computeFlowchartLayout(SECTIONS, mixed);
		const sectionTitles = nodes
			.filter((n) => n.type === "sectionHeader")
			.map((n) => (n.data as { kind: "section"; title: string }).title);
		expect(sectionTitles).toEqual(["Prep", "Execution", "Other steps"]);
	});
});

describe("computeFlowchartLayout -- empty input", () => {
	it("returns an empty layout when there are no steps", () => {
		const { nodes, edges } = computeFlowchartLayout([], []);
		expect(nodes).toHaveLength(0);
		expect(edges).toHaveLength(0);
	});
});

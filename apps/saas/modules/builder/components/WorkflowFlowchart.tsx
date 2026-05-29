"use client";

// Phase 10 / v1.5c (PRD §6.4) -- R5 lift, D-039.
//
// Read-only flowchart visualization of a published workflow, rendered as the
// right column of the Read view alongside the SOP/KB markdown article.
//
// What this renders:
//   - One custom node per step, tinted by step.type (task / approval /
//     heading / one_off; `code` and `ai` are reserved enum values but
//     currently render with the task palette since neither ships in v1.5).
//   - One section-divider node per section as a visual group header.
//   - Straight edges between consecutive steps within a section (sequential
//     execution order). No edges across sections -- the divider IS the
//     separator.
//
// What this deliberately does NOT do:
//   - No drag / no edit handles / no add-node affordance. D-041 forbids a
//     `workflow_canvas_layout` table in v1.5; this surface is reader-only.
//   - No animation, no "real-time execution coloring" -- the v2.0 PRD's
//     animated overlay was rejected (BUILD_PLAN.md Phase 10 R5 cont).
//   - No branch rendering. Conditional steps aren't in v1.5; rendering
//     branches now would be dead code. The deterministic vertical-stack
//     layout is forward-compatible: when conditions ship, we widen the
//     layout to allocate a branch column.
//
// Click behavior:
//   onSelectStep(stepId) fires when a step node is clicked. The parent
//   (ReadView) scrolls the matching `id="step-${stepId}"` anchor in the
//   markdown column into view. The node click is a navigation gesture,
//   not a selection one -- no selected-state styling persists.

import "@xyflow/react/dist/style.css";

import {
	Background,
	Controls,
	type Edge,
	type Node,
	type NodeProps,
	ReactFlow,
	ReactFlowProvider,
} from "@xyflow/react";
import { useMemo } from "react";

// ---------------------------------------------------------------------------
// Layout constants -- deterministic per D-039 (no stored layout table).
// ---------------------------------------------------------------------------

const NODE_WIDTH = 240;
const STEP_NODE_HEIGHT = 56;
const SECTION_HEADER_HEIGHT = 32;
const ROW_GAP = 16;
const SECTION_GAP = 24;
const NODE_X = 32;

// ---------------------------------------------------------------------------
// Node shapes
// ---------------------------------------------------------------------------

type StepKind = "task" | "approval" | "heading" | "one_off" | "code" | "ai";

// React Flow 12 constrains Node['data'] to `Record<string, unknown>`. Each
// discriminated variant carries an explicit index signature so the union
// satisfies the constraint while keeping the literal `kind` discriminant
// for runtime narrowing.
type StepNodeData = {
	kind: "step";
	stepId: string;
	title: string;
	stepType: StepKind;
	isOptional: boolean;
	isStopTask: boolean;
	[key: string]: unknown;
};

type SectionHeaderData = {
	kind: "section";
	title: string;
	[key: string]: unknown;
};

type FlowNodeData = StepNodeData | SectionHeaderData;

// ---------------------------------------------------------------------------
// Inputs (shape mirrors the getVersionBundle response, narrowed)
// ---------------------------------------------------------------------------

export interface FlowchartSection {
	id: string;
	title: string;
	position: number;
}

export interface FlowchartStep {
	id: string;
	title: string;
	type: StepKind;
	position: number;
	sectionId: string | null;
	isRequired: boolean;
	isStopTask: boolean;
}

interface WorkflowFlowchartProps {
	sections: ReadonlyArray<FlowchartSection>;
	steps: ReadonlyArray<FlowchartStep>;
	onSelectStep: (stepId: string) => void;
}

// ---------------------------------------------------------------------------
// Layout computation -- pure function for unit-testability.
// ---------------------------------------------------------------------------

interface LayoutOutput {
	nodes: Node<FlowNodeData>[];
	edges: Edge[];
	totalHeight: number;
}

export function computeFlowchartLayout(
	sections: ReadonlyArray<FlowchartSection>,
	steps: ReadonlyArray<FlowchartStep>,
): LayoutOutput {
	const sortedSections = [...sections].sort((a, b) => a.position - b.position);
	const stepsBySection = new Map<string | null, FlowchartStep[]>();
	for (const s of steps) {
		const key = s.sectionId ?? null;
		const arr = stepsBySection.get(key) ?? [];
		arr.push(s);
		stepsBySection.set(key, arr);
	}
	for (const arr of stepsBySection.values()) {
		arr.sort((a, b) => a.position - b.position);
	}

	const nodes: Node<FlowNodeData>[] = [];
	const edges: Edge[] = [];
	let cursorY = ROW_GAP;

	// Render in section order; trailing ungrouped steps render as their own
	// "Other steps" group when at least one section also exists, mirroring
	// ReadView's SectionBlock rendering.
	const sectionGroups: { header: string | null; sectionStepsKey: string | null }[] = [];
	for (const sec of sortedSections) {
		const items = stepsBySection.get(sec.id) ?? [];
		if (items.length === 0) continue;
		sectionGroups.push({ header: sec.title, sectionStepsKey: sec.id });
	}
	const ungrouped = stepsBySection.get(null) ?? [];
	if (ungrouped.length > 0) {
		sectionGroups.push({
			header: sectionGroups.length > 0 ? "Other steps" : null,
			sectionStepsKey: null,
		});
	}

	for (const group of sectionGroups) {
		if (group.header !== null) {
			nodes.push({
				id: `section_${group.sectionStepsKey ?? "ungrouped"}`,
				type: "sectionHeader",
				position: { x: NODE_X, y: cursorY },
				data: { kind: "section", title: group.header },
				draggable: false,
				selectable: false,
				width: NODE_WIDTH,
				height: SECTION_HEADER_HEIGHT,
			});
			cursorY += SECTION_HEADER_HEIGHT + ROW_GAP;
		}

		const items = stepsBySection.get(group.sectionStepsKey) ?? [];
		let priorStepId: string | null = null;
		for (const step of items) {
			const nodeId = `step_${step.id}`;
			nodes.push({
				id: nodeId,
				type: "step",
				position: { x: NODE_X, y: cursorY },
				data: {
					kind: "step",
					stepId: step.id,
					title: step.title,
					stepType: step.type,
					isOptional: !step.isRequired,
					isStopTask: step.isStopTask,
				},
				draggable: false,
				width: NODE_WIDTH,
				height: STEP_NODE_HEIGHT,
			});
			if (priorStepId !== null) {
				edges.push({
					id: `e_${priorStepId}__${nodeId}`,
					source: priorStepId,
					target: nodeId,
					type: "default",
					focusable: false,
				});
			}
			priorStepId = nodeId;
			cursorY += STEP_NODE_HEIGHT + ROW_GAP;
		}

		cursorY += SECTION_GAP;
	}

	return { nodes, edges, totalHeight: cursorY };
}

// ---------------------------------------------------------------------------
// Custom node renderers
// ---------------------------------------------------------------------------

const STEP_TYPE_PALETTE: Record<StepKind, { bg: string; border: string; label: string }> = {
	task: {
		bg: "bg-background",
		border: "border-l-4 border-l-slate-400 dark:border-l-slate-500",
		label: "Task",
	},
	approval: {
		bg: "bg-background",
		border: "border-l-4 border-l-indigo-500 dark:border-l-indigo-400",
		label: "Approval",
	},
	heading: {
		bg: "bg-muted/40",
		border: "border-l-4 border-l-foreground/20",
		label: "Heading",
	},
	one_off: {
		bg: "bg-background",
		border: "border-l-4 border-l-amber-500 dark:border-l-amber-400",
		label: "One-off",
	},
	// Reserved enum values -- never produced by the v1.5 publish path. Style
	// matches `task` so a stray row doesn't break the canvas.
	code: {
		bg: "bg-background",
		border: "border-l-4 border-l-slate-400 dark:border-l-slate-500",
		label: "Code",
	},
	ai: {
		bg: "bg-background",
		border: "border-l-4 border-l-violet-500 dark:border-l-violet-400",
		label: "AI",
	},
};

function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
	const palette = STEP_TYPE_PALETTE[data.stepType];
	return (
		<div
			className={`rounded-md border border-border shadow-xs px-3 py-2 text-xs flex flex-col gap-1 hover:bg-muted/40 transition-colors cursor-pointer ${palette.bg} ${palette.border}`}
			style={{ width: NODE_WIDTH, height: STEP_NODE_HEIGHT }}
		>
			<div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wide text-foreground/50">
				<span>{palette.label}</span>
				{data.isOptional && <span>· Optional</span>}
				{data.isStopTask && <span>· Gate</span>}
			</div>
			<div className="font-medium truncate">{data.title}</div>
		</div>
	);
}

function SectionHeaderNode({ data }: NodeProps<Node<SectionHeaderData>>) {
	return (
		<div
			className="flex items-end h-full text-xs uppercase tracking-wider font-semibold text-foreground/60"
			style={{ width: NODE_WIDTH, height: SECTION_HEADER_HEIGHT }}
		>
			{data.title}
		</div>
	);
}

const NODE_TYPES = {
	step: StepNode,
	sectionHeader: SectionHeaderNode,
};

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function WorkflowFlowchart({
	sections,
	steps,
	onSelectStep,
}: WorkflowFlowchartProps) {
	const { nodes, edges } = useMemo(
		() => computeFlowchartLayout(sections, steps),
		[sections, steps],
	);

	if (steps.length === 0) {
		return (
			<div className="h-full w-full flex items-center justify-center text-xs text-foreground/40">
				No steps to render.
			</div>
		);
	}

	return (
		<ReactFlowProvider>
			<div className="h-full w-full rounded-lg border border-border bg-muted/10 overflow-hidden">
				<ReactFlow
					nodes={nodes}
					edges={edges}
					nodeTypes={NODE_TYPES}
					fitView
					fitViewOptions={{ padding: 0.15 }}
					proOptions={{ hideAttribution: true }}
					nodesDraggable={false}
					nodesConnectable={false}
					elementsSelectable
					panOnDrag
					zoomOnDoubleClick={false}
					onNodeClick={(_event, node) => {
						const data = node.data as FlowNodeData;
						if (data.kind === "step") {
							onSelectStep(data.stepId);
						}
					}}
				>
					<Background gap={16} size={1} />
					<Controls showInteractive={false} className="shadow-none!" />
				</ReactFlow>
			</div>
		</ReactFlowProvider>
	);
}

"use client";

// Shared primitive (#2 of 2). Center pane for one runStep -- type chip, title,
// description, field inputs, Complete button. Mode-aware: in "complete" mode renders live
// editors + Complete; in "view" mode renders read-only field values. Future "author" mode
// (Workflow Builder) would add edit-template affordances. The panel never owns the run-
// level mutation; the parent (RunView) does.

import { cn } from "@virn/ui";
import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Button } from "@virn/ui/components/button";
import { MessageSquare } from "lucide-react";

import type { FieldSaveState, FieldType, RunStepStatus, RunViewMode, StepType } from "../types";
import { RunFieldInput } from "./RunFieldInput";

export interface RunStepPanelFieldRow {
	id: string;
	key: string;
	label: string;
	fieldType: FieldType;
	config: Record<string, unknown> | null;
	isRequired: boolean;
	position: number;
}

export interface RunStepPanelData {
	runStepId: string;
	stepId: string | null;
	title: string;
	description: string | null;
	status: RunStepStatus;
	stepType: StepType;
	blocked: boolean;
	canComplete: boolean;
	dueAt: Date | string | null;
	assigneeDisplay: string | null;
	isAssignedToMe: boolean;
}

interface RunStepPanelProps {
	data: RunStepPanelData;
	fields: readonly RunStepPanelFieldRow[];
	/** Map fieldKey -> resolved current value (post-save). */
	fieldValuesByKey: ReadonlyMap<string, unknown>;
	/** Map fieldKey -> save indicator state. */
	fieldSaveState: ReadonlyMap<string, FieldSaveState>;
	/** Map fieldKey -> validation error message (cleared on next successful save). */
	fieldErrors: ReadonlyMap<string, string | null>;
	mode: RunViewMode;
	completing: boolean;
	completeError: string | null;
	onSetFieldValue: (fieldKey: string, value: unknown) => void;
	onCompleteStep: () => void;
}

const STEP_TYPE_CHIP: Record<StepType, { label: string; className: string }> = {
	task: { label: "Task", className: "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-300" },
	approval: { label: "Approval", className: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300" },
	heading: { label: "Heading", className: "bg-muted text-muted-foreground" },
	one_off: { label: "One-off", className: "bg-purple-100 text-purple-900 dark:bg-purple-900/30 dark:text-purple-300" },
	code: { label: "Code", className: "bg-muted text-muted-foreground" },
	ai: { label: "AI", className: "bg-muted text-muted-foreground" },
};

export function RunStepPanel({
	data,
	fields,
	fieldValuesByKey,
	fieldSaveState,
	fieldErrors,
	mode,
	completing,
	completeError,
	onSetFieldValue,
	onCompleteStep,
}: RunStepPanelProps) {
	const chip = STEP_TYPE_CHIP[data.stepType];
	const isCompleted = data.status === "completed";
	const fieldsByPosition = [...fields].sort((a, b) => a.position - b.position);

	// In complete-mode, the user must be assigned (or admin -- caller passes
	// `mode="complete"` only when permitted). In view-mode, inputs are disabled.
	const inputsDisabled = mode !== "complete" || isCompleted;
	const showCompleteButton = mode === "complete" && !isCompleted && data.stepType !== "heading";

	return (
		<section className="px-5 py-4 flex flex-col min-h-0">
			<div className="gap-2 flex items-center mb-1">
				<span
					className={cn(
						"px-2 py-0.5 text-[11px] rounded font-medium uppercase tracking-wide",
						chip.className,
					)}
				>
					{chip.label}
				</span>
				<span className="text-[11px] text-foreground/50">{renderMetaLine(data)}</span>
			</div>
			<h2 className="font-medium text-lg mb-1.5">{data.title}</h2>
			{data.description && (
				<p className="text-sm text-foreground/70 leading-relaxed mb-4 whitespace-pre-wrap">
					{data.description}
				</p>
			)}

			{fieldsByPosition.length > 0 && (
				<div className="gap-4 flex flex-col mb-4">
					{fieldsByPosition.map((f) => (
						<RunFieldInput
							key={f.id}
							fieldKey={f.key}
							label={f.label}
							fieldType={f.fieldType}
							config={f.config}
							isRequired={f.isRequired}
							value={fieldValuesByKey.get(f.key) ?? null}
							saveState={fieldSaveState.get(f.key) ?? "idle"}
							errorMessage={fieldErrors.get(f.key) ?? null}
							disabled={inputsDisabled}
							onSave={(v) => onSetFieldValue(f.key, v)}
						/>
					))}
				</div>
			)}

			{data.blocked && !isCompleted && (
				<Alert className="mb-3">
					<AlertDescription className="text-xs">
						This step is blocked by an earlier stop-task. It'll unlock when its dependency is
						completed.
					</AlertDescription>
				</Alert>
			)}

			{completeError && (
				<Alert variant="error" className="mb-3">
					<AlertDescription className="text-xs">{completeError}</AlertDescription>
				</Alert>
			)}

			{showCompleteButton && (
				<div className="pt-3 border-t border-border gap-3 flex items-center">
					<Button
						variant="primary"
						onClick={onCompleteStep}
						disabled={data.blocked || !data.canComplete}
						loading={completing}
					>
						Complete step
					</Button>
					<Button
						variant="ghost"
						size="sm"
						disabled
						title="Comments coming with the comments system"
					>
						<MessageSquare className="size-3.5 mr-1" />
						Comment
					</Button>
				</div>
			)}

			{isCompleted && (
				<div className="pt-3 border-t border-border">
					<p className="text-xs text-foreground/50">
						Completed. Field values above are now read-only.
					</p>
				</div>
			)}
		</section>
	);
}

function renderMetaLine(data: RunStepPanelData): string {
	const parts: string[] = [];
	if (data.isAssignedToMe) parts.push("assigned to you");
	else if (data.assigneeDisplay) parts.push(`assigned to ${data.assigneeDisplay}`);
	if (data.dueAt) {
		const d = data.dueAt instanceof Date ? data.dueAt : new Date(data.dueAt);
		parts.push(`due ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`);
	}
	return parts.join(" · ");
}

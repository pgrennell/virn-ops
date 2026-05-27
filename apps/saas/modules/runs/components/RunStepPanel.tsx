"use client";

// Shared primitive (#2 of 2). Center pane for one runStep/step.
//
// Mode matrix:
//   complete  live editors + Complete action (assignees, admins).
//   view      read-only render of values + status.
//   preview   visually mirrors complete (so the Builder author sees what an operator
//             will see) but every interactive callback is a no-op. NO completeStep call,
//             NO field saves. The parent (BuilderView) hands in stub callbacks; the
//             panel itself doesn't dispatch any mutations.
//   author    edit-template affordances: inline title/description editors, isRequired
//             toggle, type select, per-field editor, +Add field, delete step. The
//             complete affordance is replaced by an "Edit details" / "Delete" pair.
//
// Author + preview both pass through the same shell (title block + meta line + fields
// area + footer); each mode swaps its own footer + per-field wrapper in. The shared
// shell + the field-row structure are the load-bearing thing; mode-specific pieces
// compose in, not branched throughout.

import { cn } from "@virn/ui";
import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Button } from "@virn/ui/components/button";
import { Input } from "@virn/ui/components/input";
import { Textarea } from "@virn/ui/components/textarea";
import { MessageSquare, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { FieldSaveState, FieldType, RunStatus, RunStepStatus, RunViewMode, StepType } from "../types";
import { RunFieldInput } from "./RunFieldInput";

export interface RunStepPanelFieldRow {
	id: string;
	key: string;
	label: string;
	fieldType: FieldType;
	config: Record<string, unknown> | null;
	isRequired: boolean;
	position: number;
	/** Author-mode only. When true, the field's key is referenced by a condition or
	 * due-rule and the rename affordance is disabled (D-017). Run/preview modes ignore. */
	isKeyLocked?: boolean;
}

export interface RunStepPanelData {
	runStepId: string;
	stepId: string | null;
	title: string;
	description: string | null;
	status: RunStepStatus;
	/** Run-level status. A non-active run forces read-only on every step regardless of
	 * the step's own status. */
	runStatus: RunStatus;
	stepType: StepType;
	blocked: boolean;
	canComplete: boolean;
	dueAt: Date | string | null;
	assigneeDisplay: string | null;
	isAssignedToMe: boolean;
	/** Author mode only. The step's `isRequired` flag (Pass 3 will surface it in the
	 * config panel; Pass 2 just displays it inline). */
	isRequired?: boolean;
}

export interface AuthorPanelCallbacks {
	onUpdateStepTitle: (value: string) => void;
	onUpdateStepDescription: (value: string | null) => void;
	onDeleteStep: () => void;
	onAddField: () => void;
	onUpdateFieldLabel: (fieldId: string, value: string) => void;
	onUpdateFieldRequired: (fieldId: string, value: boolean) => void;
	onDeleteField: (fieldId: string) => void;
	/** Opens the slide-in config panel for per-step settings (type, role, due rule,
	 * dependencies, conditions). Optional -- omitting renders no Configure button.
	 * Wired by BuilderView in Pass 3. */
	onConfigureStep?: () => void;
	/** Opens the slide-in config panel for per-field settings (key with lock state,
	 * type, options, required, help). Optional -- omitting renders no per-field
	 * Configure affordance. */
	onConfigureField?: (fieldId: string) => void;
}

interface RunStepPanelProps {
	data: RunStepPanelData;
	fields: readonly RunStepPanelFieldRow[];
	fieldValuesByKey: ReadonlyMap<string, unknown>;
	fieldSaveState: ReadonlyMap<string, FieldSaveState>;
	fieldErrors: ReadonlyMap<string, string | null>;
	mode: RunViewMode;
	completing: boolean;
	completeError: string | null;
	onSetFieldValue: (fieldKey: string, value: unknown) => void;
	onCompleteStep: () => void;
	/** Author-mode callbacks bundle. Required when mode === "author". */
	authorCallbacks?: AuthorPanelCallbacks;
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
	authorCallbacks,
}: RunStepPanelProps) {
	const chip = STEP_TYPE_CHIP[data.stepType];
	const isAuthor = mode === "author" && !!authorCallbacks;
	const isPreview = mode === "preview";
	const isCompleted = data.status === "completed";
	const runIsCompleted = data.runStatus === "completed" || data.runStatus === "archived";
	const fieldsByPosition = [...fields].sort((a, b) => a.position - b.position);

	// Run-engine "complete" semantics: inputs disabled when not in complete mode, when
	// the step's done, or when the run's done. Preview mode visually mirrors complete
	// (so the author sees the live look) but every mutation in this branch is a no-op
	// guaranteed by the parent (BuilderView wires onSetFieldValue/onCompleteStep to
	// noop fns in preview).
	const inputsDisabled = isAuthor || (mode !== "complete" && mode !== "preview") || isCompleted || runIsCompleted;
	const showCompleteButton =
		(mode === "complete" || isPreview) &&
		!isCompleted &&
		!runIsCompleted &&
		data.stepType !== "heading";

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
				{isPreview && (
					<span
						className="px-2 py-0.5 text-[11px] rounded font-medium uppercase tracking-wide bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300"
						title="Preview: actions in this view are no-ops"
					>
						Preview
					</span>
				)}
				{!isAuthor && (
					<span className="text-[11px] text-foreground/50">{renderMetaLine(data)}</span>
				)}
				{isAuthor && data.isRequired === false && (
					<span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wide font-medium rounded bg-muted text-muted-foreground">
						Optional
					</span>
				)}
			</div>

			{isAuthor && authorCallbacks ? (
				<AuthorTitleEditor
					value={data.title}
					onSave={authorCallbacks.onUpdateStepTitle}
				/>
			) : (
				<h2 className="font-medium text-lg mb-1.5">{data.title}</h2>
			)}

			{isAuthor && authorCallbacks ? (
				<AuthorDescriptionEditor
					value={data.description ?? ""}
					onSave={(v) => authorCallbacks.onUpdateStepDescription(v.length === 0 ? null : v)}
				/>
			) : (
				data.description && (
					<p className="text-sm text-foreground/70 leading-relaxed mb-4 whitespace-pre-wrap">
						{data.description}
					</p>
				)
			)}

			{fieldsByPosition.length > 0 && (
				<div className="gap-4 flex flex-col mb-4">
					{fieldsByPosition.map((f) =>
						isAuthor && authorCallbacks ? (
							<AuthorFieldRow
								key={f.id}
								field={f}
								onUpdateLabel={(v) => authorCallbacks.onUpdateFieldLabel(f.id, v)}
								onUpdateRequired={(v) => authorCallbacks.onUpdateFieldRequired(f.id, v)}
								onDelete={() => authorCallbacks.onDeleteField(f.id)}
								onConfigure={
									authorCallbacks.onConfigureField
										? () => authorCallbacks.onConfigureField!(f.id)
										: undefined
								}
							/>
						) : (
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
						),
					)}
				</div>
			)}

			{isAuthor && authorCallbacks && (
				<button
					type="button"
					onClick={authorCallbacks.onAddField}
					className="gap-2 flex items-center text-xs text-foreground/60 hover:text-foreground hover:bg-muted/30 px-2 py-1.5 rounded-md transition-colors self-start mb-4 -ml-2"
				>
					<Plus className="size-3.5" />
					<span>Add field</span>
				</button>
			)}

			{data.blocked && !isCompleted && !isAuthor && (
				<Alert className="mb-3">
					<AlertDescription className="text-xs">
						This step is blocked by an earlier stop-task. It'll unlock when its dependency is
						completed.
					</AlertDescription>
				</Alert>
			)}

			{completeError && !isAuthor && (
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
						{isPreview ? "Complete step (preview)" : "Complete step"}
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

			{isAuthor && authorCallbacks && (
				<div className="pt-3 border-t border-border gap-3 flex items-center">
					{authorCallbacks.onConfigureStep && (
						<Button
							variant="secondary"
							size="sm"
							onClick={authorCallbacks.onConfigureStep}
						>
							<SlidersHorizontal className="size-3.5 mr-1" />
							Configure step
						</Button>
					)}
					<Button
						variant="ghost"
						size="sm"
						onClick={authorCallbacks.onDeleteStep}
						className="text-destructive hover:text-destructive ml-auto"
					>
						<Trash2 className="size-3.5 mr-1" />
						Delete step
					</Button>
				</div>
			)}

			{isCompleted && !isAuthor && !isPreview && (
				<div className="pt-3 border-t border-border">
					<p className="text-xs text-foreground/50">
						Completed. Field values above are now read-only.
					</p>
				</div>
			)}
			{!isCompleted && runIsCompleted && !isAuthor && !isPreview && (
				<div className="pt-3 border-t border-border">
					<p className="text-xs text-foreground/50">
						{data.runStatus === "archived"
							? "This run is archived. Field values are read-only."
							: "This run completed before this step. Field values are read-only."}
					</p>
				</div>
			)}
		</section>
	);
}

// ---------------------------------------------------------------------------
// Author-mode composed pieces
// ---------------------------------------------------------------------------

function AuthorTitleEditor({
	value,
	onSave,
}: {
	value: string;
	onSave: (v: string) => void;
}) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	return (
		<Input
			value={draft}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={() => {
				if (draft.trim().length > 0 && draft !== value) onSave(draft.trim());
				else setDraft(value);
			}}
			className="text-lg font-medium mb-2 px-0 border-0 shadow-none focus-visible:ring-0 focus-visible:bg-muted/40"
			placeholder="Step title"
		/>
	);
}

function AuthorDescriptionEditor({
	value,
	onSave,
}: {
	value: string;
	onSave: (v: string) => void;
}) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	return (
		<Textarea
			value={draft}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={() => {
				if (draft !== value) onSave(draft);
			}}
			placeholder="Instructions… (optional)"
			rows={2}
			className="text-sm text-foreground/70 mb-4 resize-none border-dashed"
		/>
	);
}

function AuthorFieldRow({
	field,
	onUpdateLabel,
	onUpdateRequired,
	onDelete,
	onConfigure,
}: {
	field: RunStepPanelFieldRow;
	onUpdateLabel: (v: string) => void;
	onUpdateRequired: (v: boolean) => void;
	onDelete: () => void;
	/** Open the slide-in config panel scoped to this field. Optional -- Pass 2 didn't
	 * surface the affordance; Pass 3 wires it via BuilderView. */
	onConfigure?: () => void;
}) {
	const [labelDraft, setLabelDraft] = useState(field.label);
	useEffect(() => setLabelDraft(field.label), [field.label]);
	return (
		<div className="gap-2 flex items-start p-3 rounded-md border border-dashed border-border">
			<div className="flex-1 min-w-0 gap-1.5 flex flex-col">
				<div className="gap-2 flex items-center">
					<Input
						value={labelDraft}
						onChange={(e) => setLabelDraft(e.target.value)}
						onBlur={() => {
							if (labelDraft.trim().length > 0 && labelDraft !== field.label) {
								onUpdateLabel(labelDraft.trim());
							} else {
								setLabelDraft(field.label);
							}
						}}
						className="text-sm font-medium"
						placeholder="Field label"
					/>
					<span
						className={cn(
							"shrink-0 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded",
							field.isKeyLocked
								? "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300"
								: "bg-muted text-muted-foreground",
						)}
						title={
							field.isKeyLocked
								? "This key is referenced elsewhere (condition or due-rule) and cannot be renamed. Clear the references first."
								: "Key — used by merge variables, conditions, automations. Editable in the config panel until referenced."
						}
					>
						{field.isKeyLocked && <span aria-hidden>🔒</span>}
						{field.key}
					</span>
				</div>
				<div className="gap-3 flex items-center text-xs text-foreground/60">
					<span>{field.fieldType}</span>
					<label className="gap-1 flex items-center cursor-pointer">
						<input
							type="checkbox"
							checked={field.isRequired}
							onChange={(e) => onUpdateRequired(e.target.checked)}
							className="size-3"
						/>
						<span>Required</span>
					</label>
				</div>
			</div>
			<div className="shrink-0 flex flex-col gap-1">
				{onConfigure && (
					<Button
						variant="ghost"
						size="sm"
						onClick={onConfigure}
						className="text-foreground/40 hover:text-foreground"
						aria-label={`Configure field ${field.label}`}
					>
						<SlidersHorizontal className="size-3.5" />
					</Button>
				)}
				<Button
					variant="ghost"
					size="sm"
					onClick={onDelete}
					className="text-foreground/40 hover:text-destructive"
					aria-label={`Delete field ${field.label}`}
				>
					<Trash2 className="size-3.5" />
				</Button>
			</div>
		</div>
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

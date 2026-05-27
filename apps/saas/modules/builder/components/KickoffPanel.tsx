"use client";

// KickoffPanel -- the center editor for kickoff fields. UX_SPEC §4.3 specs the
// "kickoff form" as a peer of sections + steps in the canvas; this is the editor
// that opens when the kickoff entry is selected in the left rail.
//
// Reuses the same field-row primitive (AuthorFieldRow) that the step editor uses,
// so kickoff fields behave identically to step fields for label edit, key chip /
// lock indicator, required toggle, configure (opens FieldConfigForm), delete --
// just rendered from `bundle.fields.filter(f => f.stepId === null)` instead of
// `f.stepId === activeStepId`.
//
// What this file deliberately does NOT do:
//   - Render step-shaped settings (no type picker, no due rule, no assignee role,
//     no per-step configure or delete affordances). Kickoff isn't a step; the
//     workflow always has a kickoff form, even when empty.
//   - Render preview/run-mode UI (kickoff renders in the operator's run-view at
//     launch; the Builder shows authoring only).

import { Button } from "@virn/ui/components/button";
import { Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Input } from "@virn/ui/components/input";
import { cn } from "@virn/ui";

import type { VersionEditBundleResponse } from "../lib/types";

interface KickoffPanelProps {
	kickoffFields: VersionEditBundleResponse["fields"];
	onAddField: () => void;
	onUpdateFieldLabel: (fieldId: string, value: string) => void;
	onUpdateFieldRequired: (fieldId: string, value: boolean) => void;
	onDeleteField: (fieldId: string) => void;
	onConfigureField: (fieldId: string) => void;
}

export function KickoffPanel({
	kickoffFields,
	onAddField,
	onUpdateFieldLabel,
	onUpdateFieldRequired,
	onDeleteField,
	onConfigureField,
}: KickoffPanelProps) {
	const sortedFields = [...kickoffFields].sort((a, b) => a.position - b.position);

	return (
		<section className="px-5 py-4 flex flex-col min-h-0">
			<header className="mb-4">
				<h2 className="font-medium text-lg mb-1">Kickoff form</h2>
				<p className="text-sm text-foreground/60 leading-relaxed">
					Fields collected when the operator launches a run. Required kickoff fields
					must be filled before launch; the run engine refuses
					<code className="mx-1 px-1 py-0.5 text-xs rounded bg-muted">runs.launch</code>
					with REQUIRED_KICKOFF_FIELD_MISSING when they're not.
				</p>
			</header>

			{sortedFields.length > 0 && (
				<div className="gap-4 flex flex-col mb-4">
					{sortedFields.map((f) => (
						<KickoffFieldRow
							key={f.id}
							field={f}
							onUpdateLabel={(v) => onUpdateFieldLabel(f.id, v)}
							onUpdateRequired={(v) => onUpdateFieldRequired(f.id, v)}
							onDelete={() => onDeleteField(f.id)}
							onConfigure={() => onConfigureField(f.id)}
						/>
					))}
				</div>
			)}

			<button
				type="button"
				onClick={onAddField}
				className="gap-2 flex items-center text-xs text-foreground/60 hover:text-foreground hover:bg-muted/30 px-2 py-1.5 rounded-md transition-colors self-start -ml-2"
			>
				<Plus className="size-3.5" />
				<span>{sortedFields.length === 0 ? "Add your first kickoff field" : "Add kickoff field"}</span>
			</button>

			{sortedFields.length === 0 && (
				<p className="mt-3 text-xs text-foreground/50">
					This workflow launches with no kickoff fields. Add one if the operator should
					provide a value at launch time (e.g., a customer name, a target date).
				</p>
			)}
		</section>
	);
}

// Field row UI -- mirrors the step-editor's AuthorFieldRow but inlined here so the
// kickoff editor doesn't import from runs/components (one-directional dep). If a
// third caller eventually needs it, extract into a shared `FieldRow` primitive at
// that point -- not earlier (premature abstraction).
function KickoffFieldRow({
	field,
	onUpdateLabel,
	onUpdateRequired,
	onDelete,
	onConfigure,
}: {
	field: VersionEditBundleResponse["fields"][number];
	onUpdateLabel: (v: string) => void;
	onUpdateRequired: (v: boolean) => void;
	onDelete: () => void;
	onConfigure: () => void;
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
				<Button
					variant="ghost"
					size="sm"
					onClick={onConfigure}
					className="text-foreground/40 hover:text-foreground"
					aria-label={`Configure kickoff field ${field.label}`}
				>
					<SlidersHorizontal className="size-3.5" />
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onClick={onDelete}
					className="text-foreground/40 hover:text-destructive"
					aria-label={`Delete kickoff field ${field.label}`}
				>
					<Trash2 className="size-3.5" />
				</Button>
			</div>
		</div>
	);
}

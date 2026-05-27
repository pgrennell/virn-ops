"use client";

// Per-field input dispatcher. Renders type-appropriate UI and surfaces save state inline.
// Live-save policy:
//   - text / textarea / number  → save on BLUR (no debounced typing — avoids "did it save?"
//     anxiety; blur is unambiguous).
//   - date / select / multiselect / lookup → save on CHANGE (discrete choice; no debounce).
//   - file / image / signature / member → DEFERRED — rendered disabled with a
//     placeholder note (upload pipeline + member-select aren't wired yet).
//
// Reads + writes are scoped through the parent (RunStepPanel), which owns the mutation.
// Field key (Invariant #5) is the stable identifier for writes; this component never
// touches field.id.

import { cn } from "@virn/ui";
import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Input } from "@virn/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@virn/ui/components/select";
import { Spinner } from "@virn/ui/components/spinner";
import { Textarea } from "@virn/ui/components/textarea";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

import type { FieldSaveState, FieldType } from "../types";

interface RunFieldInputProps {
	fieldKey: string;
	label: string;
	fieldType: FieldType;
	config: Record<string, unknown> | null;
	isRequired: boolean;
	value: unknown;
	saveState: FieldSaveState;
	errorMessage: string | null;
	disabled: boolean;
	onSave: (value: unknown) => void;
}

export function RunFieldInput(props: RunFieldInputProps) {
	const { label, isRequired, saveState, errorMessage, disabled } = props;
	return (
		<div className="gap-1.5 flex flex-col">
			<div className="gap-2 flex items-center">
				<label className="text-xs text-foreground/60">
					{label}
					{isRequired && <span className="text-destructive ml-0.5">*</span>}
				</label>
				<SaveStateBadge state={saveState} />
			</div>
			{renderInput(props)}
			{errorMessage && (
				<Alert variant="error" className="py-1.5 px-2 mt-1">
					<AlertDescription className="text-xs">{errorMessage}</AlertDescription>
				</Alert>
			)}
			{disabled && DEFERRED_TYPES.has(props.fieldType) && (
				<p className="text-[11px] text-foreground/50 mt-1">
					{DEFERRED_NOTE[props.fieldType] ?? "This field type isn't editable yet."}
				</p>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Input dispatch
// ---------------------------------------------------------------------------

// `lookup` removed from this set in Phase 9b -- now editable (records picker via the
// configured data set). file/image/signature/member remain deferred to their respective
// pipelines.
const DEFERRED_TYPES = new Set<FieldType>(["file", "image", "signature", "member"]);
const DEFERRED_NOTE: Partial<Record<FieldType, string>> = {
	file: "File uploads coming with the storage pipeline.",
	image: "Image uploads coming with the storage pipeline.",
	signature: "Signature capture coming with the storage pipeline.",
	member: "Member picker coming with the org-member directory.",
};

function renderInput(props: RunFieldInputProps) {
	const { fieldType, config, value, disabled, onSave } = props;

	if (DEFERRED_TYPES.has(fieldType) || disabled) {
		return <DeferredOrDisabled value={value} fieldType={fieldType} />;
	}

	switch (fieldType) {
		case "text":
			return <TextInput value={value} config={config} onSave={onSave} />;
		case "textarea":
			return <TextareaInput value={value} config={config} onSave={onSave} />;
		case "number":
			return <NumberInput value={value} config={config} onSave={onSave} />;
		case "date":
			return <DateInput value={value} onSave={onSave} />;
		case "select":
			return <SelectInput value={value} config={config} onSave={onSave} />;
		case "multiselect":
			return <MultiselectInput value={value} config={config} onSave={onSave} />;
		case "lookup":
			return <LookupInput value={value} config={config} onSave={onSave} />;
		default:
			return <DeferredOrDisabled value={value} fieldType={fieldType} />;
	}
}

function asString(v: unknown): string {
	if (v == null) return "";
	if (typeof v === "string") return v;
	if (typeof v === "number") return String(v);
	return "";
}

function TextInput({
	value,
	config,
	onSave,
}: {
	value: unknown;
	config: Record<string, unknown> | null;
	onSave: (v: unknown) => void;
}) {
	const [draft, setDraft] = useState(asString(value));
	useEffect(() => setDraft(asString(value)), [value]);
	const maxLength = typeof config?.maxLength === "number" ? config.maxLength : undefined;
	return (
		<Input
			value={draft}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={() => {
				if (draft !== asString(value)) onSave(draft === "" ? null : draft);
			}}
			maxLength={maxLength}
		/>
	);
}

function TextareaInput({
	value,
	config,
	onSave,
}: {
	value: unknown;
	config: Record<string, unknown> | null;
	onSave: (v: unknown) => void;
}) {
	const [draft, setDraft] = useState(asString(value));
	useEffect(() => setDraft(asString(value)), [value]);
	const maxLength = typeof config?.maxLength === "number" ? config.maxLength : undefined;
	return (
		<Textarea
			value={draft}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={() => {
				if (draft !== asString(value)) onSave(draft === "" ? null : draft);
			}}
			maxLength={maxLength}
			rows={3}
		/>
	);
}

function NumberInput({
	value,
	config,
	onSave,
}: {
	value: unknown;
	config: Record<string, unknown> | null;
	onSave: (v: unknown) => void;
}) {
	const [draft, setDraft] = useState(asString(value));
	useEffect(() => setDraft(asString(value)), [value]);
	const min = typeof config?.min === "number" ? config.min : undefined;
	const max = typeof config?.max === "number" ? config.max : undefined;
	return (
		<Input
			type="number"
			value={draft}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={() => {
				if (draft === asString(value)) return;
				if (draft === "") {
					onSave(null);
					return;
				}
				const n = Number(draft);
				if (!Number.isNaN(n)) onSave(n);
			}}
			min={min}
			max={max}
		/>
	);
}

function DateInput({ value, onSave }: { value: unknown; onSave: (v: unknown) => void }) {
	return (
		<Input
			type="date"
			value={asString(value)}
			onChange={(e) => onSave(e.target.value === "" ? null : e.target.value)}
		/>
	);
}

function SelectInput({
	value,
	config,
	onSave,
}: {
	value: unknown;
	config: Record<string, unknown> | null;
	onSave: (v: unknown) => void;
}) {
	const options = Array.isArray(config?.options) ? (config.options as string[]) : [];
	return (
		<Select value={asString(value)} onValueChange={(v) => onSave(v)}>
			<SelectTrigger className="max-w-xs">
				<SelectValue placeholder="Pick one…" />
			</SelectTrigger>
			<SelectContent>
				{options.map((opt) => (
					<SelectItem key={opt} value={opt}>
						{opt}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function MultiselectInput({
	value,
	config,
	onSave,
}: {
	value: unknown;
	config: Record<string, unknown> | null;
	onSave: (v: unknown) => void;
}) {
	const options = Array.isArray(config?.options) ? (config.options as string[]) : [];
	const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
	const toggle = (opt: string) => {
		const next = new Set(selected);
		if (next.has(opt)) next.delete(opt);
		else next.add(opt);
		onSave(Array.from(next));
	};
	return (
		<div className="gap-1.5 flex flex-wrap">
			{options.map((opt) => {
				const on = selected.has(opt);
				return (
					<button
						key={opt}
						type="button"
						onClick={() => toggle(opt)}
						className={cn(
							"px-2.5 py-1 text-xs rounded border transition-colors",
							on
								? "bg-primary text-primary-foreground border-primary"
								: "border-border hover:border-foreground/40",
						)}
					>
						{opt}
					</button>
				);
			})}
		</div>
	);
}

// Lookup field renderer (Phase 9b). Reads field.config.dataSetKey, fetches the data
// set via dataSets.getByKey, renders a Select over records. value = recordId; label
// shown to the operator is record.label.
//
// Surface decisions:
//   - No dataSetKey configured: red banner ("Author this field's data set in the
//     Builder"). Setting a value is impossible.
//   - dataSetKey resolves to no data set (archived / renamed): red banner ("Data set
//     not found"). Existing value stays shown but read-only.
//   - data set has no records yet: amber hint ("No records yet -- add some in
//     /settings/data-sets").
//   - Happy path: Select with records, current value pre-selected by id.
function LookupInput({
	value,
	config,
	onSave,
}: {
	value: unknown;
	config: Record<string, unknown> | null;
	onSave: (v: unknown) => void;
}) {
	const dataSetKey =
		config && typeof config.dataSetKey === "string" ? config.dataSetKey : null;

	const dataSetQuery = useQuery({
		...orpc.dataSets.getByKey.queryOptions({
			input: { key: dataSetKey ?? "" },
		}),
		enabled: dataSetKey !== null,
	});

	if (!dataSetKey) {
		return (
			<Alert variant="error">
				<AlertDescription className="text-xs">
					This lookup field has no data set configured. Edit it in the Workflow
					Builder and pick one.
				</AlertDescription>
			</Alert>
		);
	}

	if (dataSetQuery.isLoading) {
		return (
			<div className="gap-1.5 flex items-center text-xs text-foreground/50">
				<Spinner className="size-3" /> Loading records…
			</div>
		);
	}

	if (dataSetQuery.isError || !dataSetQuery.data) {
		return (
			<Alert variant="error">
				<AlertDescription className="text-xs">
					Data set <code className="font-mono">{dataSetKey}</code> isn't available in
					this organization (archived or renamed). Update the field's binding in
					the Builder.
				</AlertDescription>
			</Alert>
		);
	}

	const records = dataSetQuery.data.records;
	if (records.length === 0) {
		return (
			<Alert variant="default">
				<AlertDescription className="text-xs">
					Data set "{dataSetQuery.data.name}" has no records yet. Add some at{" "}
					<code className="font-mono">/settings/data-sets</code>.
				</AlertDescription>
			</Alert>
		);
	}

	const current = typeof value === "string" ? value : "";

	return (
		<Select value={current} onValueChange={(v) => onSave(v)}>
			<SelectTrigger className="max-w-sm">
				<SelectValue placeholder={`Pick from ${dataSetQuery.data.name}…`} />
			</SelectTrigger>
			<SelectContent>
				{records.map((r) => (
					<SelectItem key={r.id} value={r.id}>
						{r.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function DeferredOrDisabled({ value, fieldType }: { value: unknown; fieldType: FieldType }) {
	const display =
		value && typeof value === "object" && "key" in (value as Record<string, unknown>)
			? (value as { key: string }).key
			: typeof value === "string" || typeof value === "number"
				? String(value)
				: "";
	return (
		<Input
			value={display}
			disabled
			placeholder={DEFERRED_TYPES.has(fieldType) ? "Coming soon" : ""}
		/>
	);
}

function SaveStateBadge({ state }: { state: FieldSaveState }) {
	if (state === "idle") return null;
	if (state === "saving") {
		return (
			<span className="gap-1 flex items-center text-[11px] text-foreground/50">
				<Spinner className="size-3" /> Saving
			</span>
		);
	}
	if (state === "saved") {
		return (
			<span className="gap-1 flex items-center text-[11px] text-emerald-700 dark:text-emerald-400">
				<CheckCircle2 className="size-3" /> Saved
			</span>
		);
	}
	return (
		<span className="gap-1 flex items-center text-[11px] text-destructive">
			<AlertCircle className="size-3" /> Failed
		</span>
	);
}

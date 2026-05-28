"use client";

// Field settings for the slide-in config panel (Pass 3 of UX_SPEC §4.3).
//
// Per-field settings:
//   - label                -- always editable
//   - key                  -- editable when unreferenced; locked chip + "clear these
//                             references first" hint when the server refuses with
//                             FIELD_KEY_LOCKED (D-017). Rename is AWAIT (server
//                             collision-resolves _2/_3 suffix) per useRenameField.
//   - type                 -- advanced types gated on fields.custom_definitions
//   - options              -- shown for select / multiselect, edited as one-per-line
//   - required             -- always editable
//   - help text            -- stored in field.config.helpText (jsonb)

import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Button } from "@virn/ui/components/button";
import { Input } from "@virn/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@virn/ui/components/select";
import { Textarea } from "@virn/ui/components/textarea";
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { useEffect, useState } from "react";

import type { FieldType } from "@runs/types";
import { orpc } from "@shared/lib/orpc-query-utils";

import { getFieldTypeOptions, type PaletteGates } from "../lib/capability-gates";
import type { VersionEditBundleResponse } from "../lib/types";

export interface FieldReferencer {
	type: "condition" | "due_source";
	stepId: string | null;
}

export interface FieldConfigFormProps {
	field: VersionEditBundleResponse["fields"][number];
	gates: PaletteGates;
	/** Server-supplied referencer list when the last rename refused with
	 * FIELD_KEY_LOCKED. Surfaces inline so the author can clear the references
	 * before retrying. Null when no rename has been attempted or the last one
	 * succeeded. */
	keyRenameRefusalRefs: FieldReferencer[] | null;
	keyRenamePending: boolean;
	/** Phase 12.2 -- mirrors keyRenameRefusalRefs but for the field-type guard.
	 * Set when the last type change refused with FIELD_TYPE_CHANGE_LOCKED; the
	 * referencer list comes back in the same shape so the same chip render
	 * works. Null when no type change has been attempted or the last one
	 * succeeded. */
	typeChangeRefusalRefs: FieldReferencer[] | null;
	onChangeLabel: (value: string) => void;
	onChangeKey: (value: string) => void;
	onChangeType: (value: FieldType) => void;
	onChangeRequired: (value: boolean) => void;
	onChangeOptions: (options: string[]) => void;
	onChangeHelpText: (text: string | null) => void;
	/** Phase 9b: when fieldType='lookup', updates field.config.dataSetKey -- the
	 * stable key of the data set this lookup references. Null clears the binding. */
	onChangeDataSetKey: (key: string | null) => void;
}

export function FieldConfigForm(props: FieldConfigFormProps) {
	const {
		field,
		gates,
		keyRenameRefusalRefs,
		keyRenamePending,
		typeChangeRefusalRefs,
		onChangeLabel,
		onChangeKey,
		onChangeType,
		onChangeRequired,
		onChangeOptions,
		onChangeHelpText,
		onChangeDataSetKey,
	} = props;

	const fieldTypeOptions = getFieldTypeOptions(gates);
	const helpText = (field.config as { helpText?: unknown } | null)?.helpText;
	const helpString = typeof helpText === "string" ? helpText : "";
	const options =
		(field.fieldType === "select" || field.fieldType === "multiselect") &&
		Array.isArray((field.config as { options?: unknown } | null)?.options)
			? ((field.config as { options: unknown[] }).options as string[])
			: [];
	const dataSetKey =
		field.fieldType === "lookup"
			? (() => {
					const cfg = field.config as { dataSetKey?: unknown } | null;
					return typeof cfg?.dataSetKey === "string" ? cfg.dataSetKey : null;
				})()
			: null;

	return (
		<div className="flex flex-col gap-5 px-5 py-4">
			<Section label="Label">
				<LabelEditor value={field.label} onSave={onChangeLabel} />
			</Section>

			<Section label="Key (immutable identity)">
				<KeyEditor
					value={field.key}
					locked={field.isKeyLocked}
					pending={keyRenamePending}
					refs={keyRenameRefusalRefs}
					onSave={onChangeKey}
				/>
			</Section>

			<Section label="Type">
				<Select value={field.fieldType} onValueChange={(v) => onChangeType(v as FieldType)}>
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{fieldTypeOptions.map((opt) => (
							<SelectItem key={opt.value} value={opt.value} disabled={!opt.enabled}>
								<div className="flex flex-col gap-0.5">
									<span className="flex items-center gap-1.5">
										{opt.label}
										{opt.advanced && (
											<span className="text-[9px] uppercase tracking-wide font-medium rounded px-1 py-0.5 bg-muted text-muted-foreground">
												Advanced
											</span>
										)}
										{!opt.enabled && <Lock className="size-3 text-foreground/40" />}
									</span>
									{!opt.enabled && (
										<span className="text-[10px] text-foreground/60">
											{opt.disabledReason}
										</span>
									)}
								</div>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{typeChangeRefusalRefs && typeChangeRefusalRefs.length > 0 && (
					<Alert variant="error" className="mt-2">
						<AlertDescription className="text-[11px]">
							Type change refused -- clear these references first:{" "}
							{typeChangeRefusalRefs
								.map((r) =>
									r.type === "condition" ? "show-when condition" : "step due-rule",
								)
								.join(", ")}
						</AlertDescription>
					</Alert>
				)}
			</Section>

			{(field.fieldType === "select" || field.fieldType === "multiselect") && (
				<Section label="Options">
					<OptionsEditor options={options} onChange={onChangeOptions} />
				</Section>
			)}

			{field.fieldType === "lookup" && (
				<Section label="Data set">
					<DataSetPicker
						currentKey={dataSetKey}
						onChange={onChangeDataSetKey}
					/>
				</Section>
			)}

			<Section label="Behavior">
				<label className="gap-2 flex items-center text-sm cursor-pointer">
					<input
						type="checkbox"
						checked={field.isRequired}
						onChange={(e) => onChangeRequired(e.target.checked)}
						className="size-4"
					/>
					<span>Required — operator can't complete the step until this field is filled</span>
				</label>
			</Section>

			<Section label="Help text">
				<HelpTextEditor value={helpString} onSave={onChangeHelpText} />
			</Section>
		</div>
	);
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<p className="text-xs uppercase tracking-wide font-medium text-foreground/50 mb-1.5">
				{label}
			</p>
			{children}
		</div>
	);
}

function LabelEditor({ value, onSave }: { value: string; onSave: (v: string) => void }) {
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
		/>
	);
}

function KeyEditor({
	value,
	locked,
	pending,
	refs,
	onSave,
}: {
	value: string;
	locked: boolean;
	pending: boolean;
	refs: FieldReferencer[] | null;
	onSave: (v: string) => void;
}) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	return (
		<div className="flex flex-col gap-1.5">
			<div className="gap-2 flex items-center">
				<Input
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onBlur={() => {
						if (draft.trim().length > 0 && draft !== value && !locked) onSave(draft.trim());
						else setDraft(value);
					}}
					disabled={locked || pending}
					className="font-mono text-xs"
				/>
				{locked && (
					<span
						className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300"
						title="This key is referenced by a condition or due-rule. Clear the references first."
					>
						<Lock className="size-3" /> Locked
					</span>
				)}
			</div>
			{locked && (
				<p className="text-[11px] text-foreground/60">
					This key is referenced elsewhere. Rename is locked until the references are cleared.
				</p>
			)}
			{refs && refs.length > 0 && (
				<Alert variant="error">
					<AlertDescription className="text-[11px]">
						Rename refused — clear these references first:{" "}
						{refs
							.map((r) => (r.type === "condition" ? "show-when condition" : "step due-rule"))
							.join(", ")}
					</AlertDescription>
				</Alert>
			)}
			{!locked && (
				<p className="text-[11px] text-foreground/60">
					Auto-slugged from the label. Editable until something references it (condition,
					due-rule, automation). The server collision-resolves with <code>_2</code>,{" "}
					<code>_3</code> on conflict.
				</p>
			)}
		</div>
	);
}

function OptionsEditor({
	options,
	onChange,
}: {
	options: string[];
	onChange: (next: string[]) => void;
}) {
	const [draft, setDraft] = useState(options.join("\n"));
	useEffect(() => setDraft(options.join("\n")), [options]);
	return (
		<div>
			<Textarea
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={() => {
					const next = draft
						.split("\n")
						.map((s) => s.trim())
						.filter((s) => s.length > 0);
					if (JSON.stringify(next) !== JSON.stringify(options)) {
						onChange(next);
					}
				}}
				placeholder={"One option per line…\nEmail\nSlack\nGitHub"}
				rows={4}
				className="text-sm font-mono"
			/>
			<p className="text-[11px] text-foreground/60 mt-1">One option per line.</p>
		</div>
	);
}

function HelpTextEditor({
	value,
	onSave,
}: {
	value: string;
	onSave: (v: string | null) => void;
}) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	return (
		<Textarea
			value={draft}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={() => {
				if (draft !== value) onSave(draft.trim().length === 0 ? null : draft);
			}}
			placeholder="Optional guidance shown next to this field at run time."
			rows={2}
			className="text-sm"
		/>
	);
}

void Button; // reserved -- the future "Add option" affordance lives here.

// ---------------------------------------------------------------------------
// Lookup field: data-set picker (Phase 9b)
//
// Reads available data sets from orpc.dataSets.list and lets the author pick which
// one this lookup field references. Stored as field.config.dataSetKey -- the stable
// identifier (renames in /settings/data-sets surface a warning in EditDataSetDialog).
// Surfaces three states clearly:
//   - no data sets exist yet (link to /settings/data-sets)
//   - data set picked but archived / renamed (orphan warning)
//   - data set picked + valid (display the chip)
// ---------------------------------------------------------------------------

function DataSetPicker({
	currentKey,
	onChange,
}: {
	currentKey: string | null;
	onChange: (key: string | null) => void;
}) {
	const listQuery = useQuery(orpc.dataSets.list.queryOptions({ input: {} }));
	const dataSets = listQuery.data ?? [];

	const currentExists =
		currentKey != null && dataSets.some((ds) => ds.key === currentKey);
	const isOrphaned = currentKey != null && !currentExists && !listQuery.isLoading;

	if (listQuery.isLoading) {
		return <p className="text-xs text-foreground/50">Loading data sets…</p>;
	}

	if (dataSets.length === 0) {
		return (
			<Alert variant="default">
				<AlertDescription className="text-[11px]">
					No data sets in this org yet. Create one at{" "}
					<code className="font-mono">/settings/data-sets</code>, then come back to
					pick it here.
				</AlertDescription>
			</Alert>
		);
	}

	return (
		<div className="flex flex-col gap-1.5">
			<Select
				value={currentKey ?? "__none__"}
				onValueChange={(v) => onChange(v === "__none__" ? null : v)}
			>
				<SelectTrigger>
					<SelectValue placeholder="Pick a data set…" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="__none__">No data set</SelectItem>
					{dataSets.map((ds) => (
						<SelectItem key={ds.id} value={ds.key}>
							{ds.name}{" "}
							<span className="text-foreground/50 font-mono text-[11px]">
								({ds.key})
							</span>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{isOrphaned && (
				<Alert variant="error">
					<AlertDescription className="text-[11px]">
						This field points at data set key <code className="font-mono">{currentKey}</code>{" "}
						which no longer exists (archived or renamed). Pick a different set or
						restore the original. New runs will refuse this field's writes.
					</AlertDescription>
				</Alert>
			)}
			{!isOrphaned && (
				<p className="text-[11px] text-foreground/60">
					Runtime: operators pick from the data set's records (label + optional
					value). Field stores the chosen record's id.
				</p>
			)}
		</div>
	);
}

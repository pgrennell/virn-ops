"use client";

// Step settings for the slide-in config panel (Pass 3 of UX_SPEC §4.3).
//
// Per-step settings:
//   - type            -- capability-gated; approval needs governance.approvals
//   - assignee role   -- picker over the org's workflow_role rows
//   - due rule        -- Phase 12.2: all four dueTypes live. offset_from_step
//                        adds an anchor-step picker; from_date_field adds a
//                        date-field picker over the version's date fields
//                        (kickoff + step).
//   - isRequired      -- when off, the run cascade can complete without this step
//   - isStopTask      -- when on, dependent steps wait for this one
//   - Show-when       -- gated on automation.rules; Pass 3 shows a "coming soon"
//                        placeholder rather than a full visual builder (defer per
//                        original brief)
//   - Blocked-by      -- gated on automation.rules; lets the author pick another
//                        step in this version as a dependency (step_dependency row)
//
// All writes route through useUpdateStep (optimistic for title/description/required,
// the rest happens via the same hook -- the cache patch covers structural fields
// per builder-mutations.ts).

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
import { Lock, Plus, X } from "lucide-react";
import { useState } from "react";

import type { StepType } from "@runs/types";

import { type DueType, getDueTypeOptions, getStepTypeOptions, type PaletteGates } from "../lib/capability-gates";
import type { VersionEditBundleResponse } from "../lib/types";

export interface StepConfigFormProps {
	step: VersionEditBundleResponse["steps"][number];
	allSteps: VersionEditBundleResponse["steps"];
	/** Phase 12.2 -- the version's full field set (kickoff + step), used by the
	 * from_date_field source-field picker. Filtered to fieldType='date' before
	 * rendering; an empty list disables the dueType option with a hint. */
	allFields: VersionEditBundleResponse["fields"];
	dependencies: VersionEditBundleResponse["dependencies"];
	workflowRoles: Array<{ id: string; name: string }>;
	gates: PaletteGates;
	onChangeType: (type: StepType) => void;
	onChangeAssignedRole: (roleId: string | null) => void;
	/** Phase 12.2 -- payload widens to carry the anchor / source-field refs in
	 * one round-trip when the dueType requires them. The caller (BuilderView)
	 * forwards everything to updateStep.mutate, which accepts the same shape. */
	onChangeDueRule: (input: {
		dueType: DueType;
		dueOffsetDays: number | null;
		dueAnchorStepId?: string | null;
		dueSourceFieldId?: string | null;
	}) => void;
	onToggleRequired: (value: boolean) => void;
	onToggleStopTask: (value: boolean) => void;
	onAddDependency: (dependsOnStepId: string) => void;
	onRemoveDependency: (dependsOnStepId: string) => void;
	/** Inline + New role affordance in the assignee picker. Resolves to the new
	 * role's id so the form can auto-select it. AWAIT semantics by contract --
	 * server owns the cuid. Adjacent fix from the Pass-3 review: without this,
	 * a fresh-org first-run lands in an empty picker with no recovery. */
	onCreateRole: (name: string) => Promise<{ id: string }>;
}

export function StepConfigForm(props: StepConfigFormProps) {
	const {
		step,
		allSteps,
		allFields,
		dependencies,
		workflowRoles,
		gates,
		onChangeType,
		onChangeAssignedRole,
		onChangeDueRule,
		onToggleRequired,
		onToggleStopTask,
		onAddDependency,
		onRemoveDependency,
		onCreateRole,
	} = props;

	const stepTypeOptions = getStepTypeOptions(gates);
	const dueOptions = getDueTypeOptions();
	const stepDeps = dependencies.filter((d) => d.stepId === step.id);
	const otherSteps = allSteps.filter((s) => s.id !== step.id);
	// Date fields eligible to source a from_date_field due rule. Both kickoff
	// (stepId === null) and step-scoped fields qualify. A field whose step IS
	// this step is excluded -- self-reference would be circular (the step's
	// deadline depending on a field collected during itself).
	const dateFieldOptions = allFields.filter(
		(f) => f.fieldType === "date" && f.stepId !== step.id,
	);

	return (
		<div className="flex flex-col gap-5 px-5 py-4">
			<Section label="Step type">
				<Select value={step.type} onValueChange={(v) => onChangeType(v as StepType)}>
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{stepTypeOptions.map((opt) => (
							<SelectItem key={opt.value} value={opt.value} disabled={!opt.enabled}>
								<div className="flex flex-col gap-0.5">
									<span className="flex items-center gap-1.5">
										{opt.label}
										{!opt.enabled && <Lock className="size-3 text-foreground/40" />}
									</span>
									<span className="text-[10px] text-foreground/60">
										{opt.enabled ? opt.description : opt.disabledReason}
									</span>
								</div>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</Section>

			<Section label="Assignee role">
				<Select
					value={step.assignedRoleId ?? "__none__"}
					onValueChange={(v) => onChangeAssignedRole(v === "__none__" ? null : v)}
				>
					<SelectTrigger>
						<SelectValue placeholder="Unassigned" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="__none__">Unassigned</SelectItem>
						{workflowRoles.map((r) => (
							<SelectItem key={r.id} value={r.id}>
								{r.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<InlineRoleCreator
					hasExistingRoles={workflowRoles.length > 0}
					onCreate={async (name) => {
						const result = await onCreateRole(name);
						// Auto-select the new role -- removes a click and signals success.
						onChangeAssignedRole(result.id);
					}}
				/>
			</Section>

			<Section label="Due rule">
				<Select
					value={step.dueType}
					onValueChange={(v) => {
						const dueType = v as DueType;
						const supported = dueOptions.find((o) => o.value === dueType)?.enabled ?? false;
						if (!supported) return;
						// Seed default offset to 0 (not 1) so the seeded value MATCHES what
						// the offset input below renders via `step.dueOffsetDays ?? 0`.
						// Pre-fix, the seed sent 1 while the input read 0 -- a brief
						// state-truth divergence until the next bundle refetch landed.
						// Companion refs are nulled here in addition to the structure-
						// layer's normalizeDuePatch so the optimistic-render path doesn't
						// briefly show stale anchor/source choices in the picker.
						const next: Parameters<typeof onChangeDueRule>[0] = {
							dueType,
							dueOffsetDays:
								dueType === "none" ? null : step.dueOffsetDays ?? 0,
							dueAnchorStepId:
								dueType === "offset_from_step" ? step.dueAnchorStepId ?? null : null,
							dueSourceFieldId:
								dueType === "from_date_field" ? step.dueSourceFieldId ?? null : null,
						};
						onChangeDueRule(next);
					}}
				>
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{dueOptions.map((opt) => (
							<SelectItem key={opt.value} value={opt.value} disabled={!opt.enabled}>
								<div className="flex flex-col gap-0.5">
									<span className="flex items-center gap-1.5">
										{opt.label}
										{!opt.enabled && <Lock className="size-3 text-foreground/40" />}
									</span>
									<span className="text-[10px] text-foreground/60">
										{opt.enabled ? opt.description : opt.disabledReason}
									</span>
								</div>
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				{/* Offset input: shown for all three dueTypes that need it. The label
				 * adapts to the dueType. min=0 for offset_from_start (negative = before
				 * launch makes no sense); allow negatives for offset_from_step and
				 * from_date_field where "N days before X" is a real authoring pattern. */}
				{(step.dueType === "offset_from_start" ||
					step.dueType === "offset_from_step" ||
					step.dueType === "from_date_field") && (
					<div className="mt-2 gap-2 flex items-center">
						<Input
							type="number"
							min={step.dueType === "offset_from_start" ? 0 : undefined}
							value={step.dueOffsetDays ?? 0}
							onChange={(e) => {
								// Empty string -> 0 so a user backspacing the field to clear
								// it can actually land on zero. Pre-fix, parseInt('') = NaN
								// and the change was silently dropped, so 'clear to zero'
								// required typing the digit. Any other non-numeric input
								// (parseInt returning NaN) still drops -- the type=number
								// input itself prevents most such cases at the browser layer.
								const raw = e.target.value;
								const n = raw === "" ? 0 : Number.parseInt(raw, 10);
								if (!Number.isFinite(n)) return;
								if (step.dueType === "offset_from_start" && n < 0) return;
								onChangeDueRule({
									dueType: step.dueType,
									dueOffsetDays: n,
									dueAnchorStepId:
										step.dueType === "offset_from_step"
											? step.dueAnchorStepId ?? null
											: null,
									dueSourceFieldId:
										step.dueType === "from_date_field"
											? step.dueSourceFieldId ?? null
											: null,
								});
							}}
							className="w-24"
						/>
						<span className="text-xs text-foreground/60">
							{step.dueType === "offset_from_start" && "days after run starts"}
							{step.dueType === "offset_from_step" &&
								"days after the anchor step completes (negative = before)"}
							{step.dueType === "from_date_field" &&
								"days from the source field's date (negative = before)"}
						</span>
					</div>
				)}

				{/* Anchor step picker for offset_from_step. Pulls from all OTHER steps in
				 * the version (self-anchor is rejected by the run engine + validator). An
				 * empty otherSteps list disables the picker with an inline hint. */}
				{step.dueType === "offset_from_step" && (
					<div className="mt-2">
						<label className="text-[11px] text-foreground/60 mb-1 block">
							Anchor on which step's completion?
						</label>
						{otherSteps.length === 0 ? (
							<p className="text-xs text-foreground/50 italic">
								Add another step to use it as an anchor.
							</p>
						) : (
							<Select
								value={step.dueAnchorStepId ?? ""}
								onValueChange={(v) =>
									onChangeDueRule({
										dueType: "offset_from_step",
										dueOffsetDays: step.dueOffsetDays ?? 1,
										dueAnchorStepId: v.length === 0 ? null : v,
										dueSourceFieldId: null,
									})
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="Pick an anchor step…" />
								</SelectTrigger>
								<SelectContent>
									{otherSteps.map((s) => (
										<SelectItem key={s.id} value={s.id}>
											{s.title}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
					</div>
				)}

				{/* Source-field picker for from_date_field. Only date fields qualify.
				 * Self-step fields are filtered out (circular: deadline depending on a
				 * field collected during the same step). */}
				{step.dueType === "from_date_field" && (
					<div className="mt-2">
						<label className="text-[11px] text-foreground/60 mb-1 block">
							Date field to anchor the deadline on
						</label>
						{dateFieldOptions.length === 0 ? (
							<p className="text-xs text-foreground/50 italic">
								No eligible date fields yet — add a kickoff date or a date field
								on another step.
							</p>
						) : (
							<Select
								value={step.dueSourceFieldId ?? ""}
								onValueChange={(v) =>
									onChangeDueRule({
										dueType: "from_date_field",
										dueOffsetDays: step.dueOffsetDays ?? 0,
										dueAnchorStepId: null,
										dueSourceFieldId: v.length === 0 ? null : v,
									})
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="Pick a date field…" />
								</SelectTrigger>
								<SelectContent>
									{dateFieldOptions.map((f) => (
										<SelectItem key={f.id} value={f.id}>
											{f.label}{" "}
											<span className="text-foreground/50">
												({f.stepId === null ? "kickoff" : "step field"})
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
					</div>
				)}
			</Section>

			<Section label="Behavior">
				<label className="gap-2 flex items-center text-sm cursor-pointer">
					<input
						type="checkbox"
						checked={step.isRequired}
						onChange={(e) => onToggleRequired(e.target.checked)}
						className="size-4"
					/>
					<span>Required — run can't auto-complete until this step is done</span>
				</label>
				<label className="gap-2 flex items-center text-sm cursor-pointer mt-2">
					<input
						type="checkbox"
						checked={step.isStopTask}
						onChange={(e) => onToggleStopTask(e.target.checked)}
						className="size-4"
					/>
					<span>Stop-task — other steps can list this as a "Blocked by" dependency</span>
				</label>
			</Section>

			<Section label="Blocked by (stop-task dependencies)">
				{!gates.stopTaskEditor ? (
					<DisabledByCapability message="Needs the Automation capability. Turn it on in Settings → Configuration." />
				) : (
					<>
						<ul className="flex flex-col gap-1.5">
							{stepDeps.length === 0 && (
								<li className="text-xs text-foreground/60">No dependencies. This step can start any time.</li>
							)}
							{stepDeps.map((d) => {
								const dep = allSteps.find((s) => s.id === d.dependsOnStepId);
								return (
									<li
										key={d.dependsOnStepId}
										className="gap-2 flex items-center px-2 py-1.5 text-sm rounded bg-muted/40"
									>
										<span className="flex-1 truncate">
											{dep?.title ?? "(deleted step)"}
										</span>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => onRemoveDependency(d.dependsOnStepId)}
											className="size-6 p-0 text-foreground/40 hover:text-destructive"
											aria-label="Remove dependency"
										>
											<X className="size-3.5" />
										</Button>
									</li>
								);
							})}
						</ul>
						<Select
							value="__add__"
							onValueChange={(v) => {
								if (v !== "__add__") onAddDependency(v);
							}}
						>
							<SelectTrigger className="mt-2">
								<SelectValue placeholder="Add a dependency…" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="__add__" disabled>
									Add a dependency…
								</SelectItem>
								{otherSteps
									.filter((s) => !stepDeps.some((d) => d.dependsOnStepId === s.id))
									.map((s) => (
										<SelectItem key={s.id} value={s.id}>
											{s.title}
										</SelectItem>
									))}
							</SelectContent>
						</Select>
					</>
				)}
			</Section>

			<Section label="Show-when condition">
				{!gates.conditionEditor ? (
					<DisabledByCapability message="Needs the Automation capability. Turn it on in Settings → Configuration." />
				) : (
					<Alert>
						<AlertDescription className="text-xs">
							The inline condition editor is reserved for a follow-on pass. Today, every
							step always shows; rules table edits via the Automations area.
						</AlertDescription>
					</Alert>
				)}
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

function DisabledByCapability({ message }: { message: string }) {
	return (
		<Alert>
			<AlertDescription className="text-xs gap-1.5 flex items-start">
				<Lock className="size-3 mt-0.5 shrink-0 text-foreground/40" />
				<span>{message}</span>
			</AlertDescription>
		</Alert>
	);
}

// Inline + New role affordance. Collapsed = a small ghost button below the picker.
// Expanded = name input + Add / Cancel. On Add: calls onCreate (which awaits the
// server's response and returns the new id), the parent auto-selects, and the input
// collapses. Modal would interrupt the config-panel flow; inline keeps the user in
// context. Adjacent fix from the Pass-3 review.
function InlineRoleCreator({
	hasExistingRoles,
	onCreate,
}: {
	hasExistingRoles: boolean;
	onCreate: (name: string) => Promise<void>;
}) {
	const [expanded, setExpanded] = useState(false);
	const [draft, setDraft] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (!expanded) {
		return (
			<div className="mt-1.5">
				<button
					type="button"
					onClick={() => {
						setExpanded(true);
						setDraft("");
						setError(null);
					}}
					className="gap-1.5 inline-flex items-center text-xs text-foreground/60 hover:text-foreground transition-colors"
				>
					<Plus className="size-3" />
					<span>
						{hasExistingRoles ? "New role" : "Create your first role"}
					</span>
				</button>
				{!hasExistingRoles && (
					<p className="text-[11px] text-foreground/50 mt-1">
						No roles defined yet. Roles let you assign steps to people at run time
						("Operator", "Reviewer", etc.).
					</p>
				)}
			</div>
		);
	}

	const submit = async () => {
		const name = draft.trim();
		if (name.length === 0) {
			setExpanded(false);
			return;
		}
		setPending(true);
		setError(null);
		try {
			await onCreate(name);
			setExpanded(false);
			setDraft("");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't create the role.");
		} finally {
			setPending(false);
		}
	};

	return (
		<div className="mt-1.5">
			<div className="gap-2 flex items-center">
				<Input
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							void submit();
						} else if (e.key === "Escape") {
							setExpanded(false);
						}
					}}
					placeholder="Role name…"
					disabled={pending}
					autoFocus
					className="text-sm"
				/>
				<Button size="sm" variant="primary" onClick={submit} disabled={pending}>
					Add
				</Button>
				<Button
					size="sm"
					variant="ghost"
					onClick={() => setExpanded(false)}
					disabled={pending}
				>
					Cancel
				</Button>
			</div>
			{error && (
				<Alert variant="error" className="mt-2">
					<AlertDescription className="text-xs">{error}</AlertDescription>
				</Alert>
			)}
		</div>
	);
}

"use client";

// Step settings for the slide-in config panel (Pass 3 of UX_SPEC §4.3).
//
// Per-step settings:
//   - type            -- capability-gated; approval needs governance.approvals
//   - assignee role   -- picker over the org's workflow_role rows
//   - due rule        -- only none + offset_from_start live; others "coming soon"
//                        (memory: project_due_type_ui_constraint.md)
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
import { Lock, X } from "lucide-react";

import type { StepType } from "@runs/types";

import { type DueType, getDueTypeOptions, getStepTypeOptions, type PaletteGates } from "../lib/capability-gates";
import type { VersionEditBundleResponse } from "../lib/types";

export interface StepConfigFormProps {
	step: VersionEditBundleResponse["steps"][number];
	allSteps: VersionEditBundleResponse["steps"];
	dependencies: VersionEditBundleResponse["dependencies"];
	workflowRoles: Array<{ id: string; name: string }>;
	gates: PaletteGates;
	onChangeType: (type: StepType) => void;
	onChangeAssignedRole: (roleId: string | null) => void;
	onChangeDueRule: (input: { dueType: DueType; dueOffsetDays: number | null }) => void;
	onToggleRequired: (value: boolean) => void;
	onToggleStopTask: (value: boolean) => void;
	onAddDependency: (dependsOnStepId: string) => void;
	onRemoveDependency: (dependsOnStepId: string) => void;
}

export function StepConfigForm(props: StepConfigFormProps) {
	const {
		step,
		allSteps,
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
	} = props;

	const stepTypeOptions = getStepTypeOptions(gates);
	const dueOptions = getDueTypeOptions();
	const stepDeps = dependencies.filter((d) => d.stepId === step.id);
	const otherSteps = allSteps.filter((s) => s.id !== step.id);

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
				{workflowRoles.length === 0 && (
					<p className="text-xs text-foreground/60 mt-1.5">
						No workflow roles defined. Create them via the workflow roles list.
					</p>
				)}
			</Section>

			<Section label="Due rule">
				<Select
					value={step.dueType}
					onValueChange={(v) => {
						const dueType = v as DueType;
						const supported = dueOptions.find((o) => o.value === dueType)?.enabled ?? false;
						if (!supported) return;
						onChangeDueRule({
							dueType,
							dueOffsetDays: dueType === "offset_from_start" ? (step.dueOffsetDays ?? 1) : null,
						});
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
				{step.dueType === "offset_from_start" && (
					<div className="mt-2 gap-2 flex items-center">
						<Input
							type="number"
							min={0}
							value={step.dueOffsetDays ?? 1}
							onChange={(e) => {
								const n = Number.parseInt(e.target.value, 10);
								if (Number.isFinite(n) && n >= 0) {
									onChangeDueRule({ dueType: "offset_from_start", dueOffsetDays: n });
								}
							}}
							className="w-24"
						/>
						<span className="text-xs text-foreground/60">days after run starts</span>
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

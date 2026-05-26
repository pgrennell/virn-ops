"use client";

// Guest-side Run view (UX_SPEC §5.4, Phase 3.5). Standalone — no session, no org, no
// sidebar chrome. Token is read from `window.location.hash` so it never hits server
// access logs. The narrowed payload from /runs/guest/get already strips everything the
// guest shouldn't see; this component just renders what it's given.

import { cn } from "@virn/ui";
import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Button } from "@virn/ui/components/button";
import { Spinner } from "@virn/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Lock } from "lucide-react";
import { useEffect, useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

import type { FieldSaveState, FieldType } from "../types";
import { RunFieldInput } from "./RunFieldInput";

// Step shape mirrors the GuestStep type exported by `packages/api/modules/runs/lib/guest.ts`.
// Inlined here to avoid coupling the client to the api lib's internal types; structural
// matching keeps the contract enforced.
interface GuestStepRow {
	runStepId: string;
	title: string;
	description: string | null;
	stepType: string;
	status: "pending" | "completed" | "skipped" | "not_applicable";
	dueAt: Date | string | null;
	blocked: boolean;
	canComplete: boolean;
	fields: Array<{
		key: string;
		label: string;
		fieldType: string;
		config: Record<string, unknown> | null;
		isRequired: boolean;
		value: unknown;
	}>;
}

function readTokenFromHash(): string | null {
	if (typeof window === "undefined") return null;
	const hash = window.location.hash.replace(/^#/, "");
	if (!hash) return null;
	const params = new URLSearchParams(hash);
	return params.get("token");
}

export function GuestRunView() {
	const [token, setToken] = useState<string | null>(null);
	const [tokenChecked, setTokenChecked] = useState(false);

	// Defer the hash read to mount so SSR doesn't try to access window.
	useEffect(() => {
		setToken(readTokenFromHash());
		setTokenChecked(true);
	}, []);

	if (!tokenChecked) {
		return <CenteredSpinner label="Loading…" />;
	}

	if (!token) {
		return (
			<div className="mx-auto max-w-md px-5 py-16 text-center">
				<h1 className="text-lg font-semibold">No access link provided</h1>
				<p className="mt-2 text-sm text-foreground/60">
					Open the link from your invitation email. The page expects a token in the URL.
				</p>
			</div>
		);
	}

	return <GuestRunInner token={token} />;
}

function GuestRunInner({ token }: { token: string }) {
	const queryClient = useQueryClient();
	const queryOpts = orpc.runs.getForGuest.queryOptions({ input: { token } });
	const queryKey = orpc.runs.getForGuest.queryKey({ input: { token } });
	const { data, isLoading, isError, error } = useQuery(queryOpts);

	const setFieldValue = useMutation(orpc.runs.setFieldValueAsGuest.mutationOptions());
	const completeStep = useMutation(orpc.runs.completeStepAsGuest.mutationOptions());

	const [activeRunStepId, setActiveRunStepId] = useState<string | null>(null);
	const [fieldSaveState, setFieldSaveState] = useState<Map<string, FieldSaveState>>(new Map());
	const [fieldErrors, setFieldErrors] = useState<Map<string, string | null>>(new Map());
	const [completeError, setCompleteError] = useState<string | null>(null);

	useEffect(() => {
		if (!data || activeRunStepId) return;
		const candidate =
			data.steps.find((s) => s.status === "pending" && !s.blocked) ??
			data.steps.find((s) => s.status === "pending") ??
			data.steps[0];
		if (candidate) setActiveRunStepId(candidate.runStepId);
	}, [data, activeRunStepId]);

	if (isLoading) {
		return <CenteredSpinner label="Loading your tasks…" />;
	}

	if (isError || !data) {
		return (
			<div className="mx-auto max-w-md px-5 py-16 text-center">
				<h1 className="text-lg font-semibold">This link isn't valid</h1>
				<p className="mt-2 text-sm text-foreground/60">
					{error?.message ??
						"The link may have expired or been revoked. Ask whoever sent it to issue a new one."}
				</p>
			</div>
		);
	}

	const activeStep = data.steps.find((s) => s.runStepId === activeRunStepId) ?? null;
	const runIsActive = data.runStatus === "active";

	const onSetFieldValue = (fieldKey: string, value: unknown) => {
		if (!activeStep) return;
		setFieldSaveState((m) => new Map(m).set(fieldKey, "saving"));
		setFieldErrors((m) => new Map(m).set(fieldKey, null));
		setFieldValue.mutate(
			{ token, runStepId: activeStep.runStepId, fieldKey, value },
			{
				onSuccess: async () => {
					setFieldSaveState((m) => new Map(m).set(fieldKey, "saved"));
					await queryClient.invalidateQueries({ queryKey });
					setTimeout(() => {
						setFieldSaveState((m) => {
							const next = new Map(m);
							if (next.get(fieldKey) === "saved") next.set(fieldKey, "idle");
							return next;
						});
					}, 1500);
				},
				onError: (err) => {
					setFieldSaveState((m) => new Map(m).set(fieldKey, "error"));
					setFieldErrors((m) => new Map(m).set(fieldKey, err.message));
				},
			},
		);
	};

	const onCompleteStep = () => {
		if (!activeStep) return;
		setCompleteError(null);
		completeStep.mutate(
			{ token, runStepId: activeStep.runStepId },
			{
				onSuccess: async () => {
					await queryClient.invalidateQueries({ queryKey });
				},
				onError: (err) => setCompleteError(err.message),
			},
		);
	};

	return (
		<div className="mx-auto max-w-5xl px-5 py-8">
			<header className="mb-6">
				<p className="text-xs uppercase tracking-wider text-foreground/50">
					{data.organization.name}
				</p>
				<h1 className="text-2xl font-semibold mt-1">{data.runTitle}</h1>
				<p className="mt-1 text-sm text-foreground/60">
					{data.participant.guestName ?? data.participant.guestEmail ?? "Guest"} ·{" "}
					{data.steps.length === 0
						? "Nothing assigned to you"
						: `${data.steps.length} task${data.steps.length === 1 ? "" : "s"} for you`}
				</p>
				{!runIsActive && (
					<Alert className="mt-3">
						<AlertDescription className="text-xs">
							This run is {data.runStatus}. Your tasks are read-only.
						</AlertDescription>
					</Alert>
				)}
			</header>

			{data.steps.length === 0 ? (
				<div className="rounded-lg border border-border bg-muted/20 p-8 text-center text-sm text-foreground/60">
					You have no tasks on this run. Nothing to do here — you can close this tab.
				</div>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-[16rem_1fr] gap-6">
					<aside className="rounded-lg border border-border bg-muted/20 p-2">
						<ul className="flex flex-col">
							{data.steps.map((s) => (
								<li key={s.runStepId}>
									<button
										type="button"
										onClick={() => setActiveRunStepId(s.runStepId)}
										className={cn(
											"w-full text-left rounded-md px-3 py-2 text-sm flex items-center gap-2",
											s.runStepId === activeRunStepId
												? "bg-background shadow-sm"
												: "hover:bg-background/60",
										)}
									>
										<GuestStepIcon status={s.status} blocked={s.blocked} />
										<span className="truncate flex-1">{s.title}</span>
									</button>
								</li>
							))}
						</ul>
					</aside>

					<section className="rounded-lg border border-border bg-background p-6">
						{activeStep ? (
							<GuestStepPanel
								step={activeStep}
								runActive={runIsActive}
								fieldSaveState={fieldSaveState}
								fieldErrors={fieldErrors}
								completing={completeStep.isPending}
								completeError={completeError}
								onSetFieldValue={onSetFieldValue}
								onCompleteStep={onCompleteStep}
							/>
						) : (
							<p className="text-sm text-foreground/60">Pick a task on the left to begin.</p>
						)}
					</section>
				</div>
			)}
		</div>
	);
}

function GuestStepIcon({
	status,
	blocked,
}: {
	status: "pending" | "completed" | "skipped" | "not_applicable";
	blocked: boolean;
}) {
	if (status === "completed") {
		return <CheckCircle2 className="size-4 text-green-600 shrink-0" />;
	}
	if (blocked) {
		return <Lock className="size-4 text-foreground/40 shrink-0" />;
	}
	return <span className="size-2 rounded-full bg-foreground/30 shrink-0 ml-1 mr-0.5" />;
}

function GuestStepPanel({
	step,
	runActive,
	fieldSaveState,
	fieldErrors,
	completing,
	completeError,
	onSetFieldValue,
	onCompleteStep,
}: {
	step: GuestStepRow;
	runActive: boolean;
	fieldSaveState: ReadonlyMap<string, FieldSaveState>;
	fieldErrors: ReadonlyMap<string, string | null>;
	completing: boolean;
	completeError: string | null;
	onSetFieldValue: (fieldKey: string, value: unknown) => void;
	onCompleteStep: () => void;
}) {
	const editable = runActive && step.status === "pending" && !step.blocked;

	return (
		<div className="flex flex-col gap-5">
			<div>
				<h2 className="text-lg font-semibold">{step.title}</h2>
				{step.description && (
					<p className="mt-1 text-sm text-foreground/70 whitespace-pre-wrap">{step.description}</p>
				)}
			</div>

			{step.blocked && step.status === "pending" && (
				<Alert>
					<AlertDescription className="text-xs">
						This task is waiting on another step to complete first.
					</AlertDescription>
				</Alert>
			)}

			{step.fields.length > 0 && (
				<div className="flex flex-col gap-4">
					{step.fields.map((f) => (
						<RunFieldInput
							key={f.key}
							fieldKey={f.key}
							label={f.label}
							fieldType={f.fieldType as FieldType}
							config={f.config}
							isRequired={f.isRequired}
							value={f.value}
							saveState={fieldSaveState.get(f.key) ?? "idle"}
							errorMessage={fieldErrors.get(f.key) ?? null}
							disabled={!editable}
							onSave={(v) => onSetFieldValue(f.key, v)}
						/>
					))}
				</div>
			)}

			{editable && (
				<div className="flex flex-col gap-2 pt-2 border-t border-border">
					<div>
						<Button onClick={onCompleteStep} disabled={!step.canComplete || completing}>
							{completing ? "Completing…" : "Mark complete"}
						</Button>
					</div>
					{!step.canComplete && step.fields.some((f) => f.isRequired) && (
						<p className="text-xs text-foreground/60">
							Fill the required fields before marking this complete.
						</p>
					)}
					{completeError && (
						<Alert variant="error">
							<AlertDescription className="text-xs">{completeError}</AlertDescription>
						</Alert>
					)}
				</div>
			)}

			{step.status === "completed" && (
				<div className="rounded-md bg-green-50 dark:bg-green-900/20 px-3 py-2 text-xs text-green-900 dark:text-green-300 flex items-center gap-2">
					<CheckCircle2 className="size-4" /> Completed — thanks!
				</div>
			)}
		</div>
	);
}

function CenteredSpinner({ label }: { label: string }) {
	return (
		<div className="flex items-center justify-center gap-3 py-24 text-foreground/60">
			<Spinner className="size-4" /> {label}
		</div>
	);
}

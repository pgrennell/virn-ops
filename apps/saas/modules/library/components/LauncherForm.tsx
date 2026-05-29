"use client";

// LauncherForm -- container-agnostic launcher body.
//
// Renders the published version's kickoff form (RunFieldInput per kickoff field) +
// a per-workflowRole assignee picker (members-only for v1; guests deferred per
// STRATEGY S-04). On submit: calls runs.launch with the PINNED workflowVersionId
// (integrity #1 -- closes the publish-during-fill-window race per D-018; the
// version the user filled is the version snapshotted).
//
// Container-agnostic by construction: this file declares no slide-in, no route,
// no header chrome. LauncherPanel wraps it in the drawer; a future LauncherRoute
// could wrap it in a page without rewriting. The cheap-migration promise from the
// Launcher plan turn rests on this separation.
//
// What this file does NOT do:
//   - Discover the latest published versionId (the parent passes it in)
//   - Decide whether the launcher should be open (the parent's panel state)
//   - Handle guest assignment (members-only; deferred per S-04)
//   - Run a preview / dry-render (Builder has Preview; this is the real thing)

import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Button } from "@virn/ui/components/button";
import { Spinner } from "@virn/ui/components/spinner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useMemo, useState } from "react";

import { useSession } from "@auth/hooks/use-session";
import type { FieldSaveState, FieldType } from "@runs/types";
import { RunFieldInput } from "@runs/components/RunFieldInput";
import { orpc } from "@shared/lib/orpc-query-utils";

import {
	findMissingRequiredKickoffFields,
	type KickoffFieldDescriptor,
} from "../lib/launcher-validation";
import type { LaunchMode } from "../lib/launcher-types";
import { LaunchModePicker } from "./LaunchModePicker";
import {
	type AssigneeChoice,
	RoleAssigneePicker,
} from "./RoleAssigneePicker";

interface LauncherFormProps {
	/** The workflow row that the Run action opened the launcher for. The
	 * `latestPublishedVersionId` is the pin: form rendered from this version, launch
	 * call passes this version -- form-version and launch-version are provably
	 * identical (integrity #1). */
	workflow: {
		id: string;
		title: string;
		latestPublishedVersionId: string;
	};
	organizationSlug: string;
	/** Phase 8 step 3 -- when true, the LaunchModePicker is rendered above the kickoff
	 * fields. When false, the form only supports "human" mode (no picker; same shape
	 * as pre-Phase-8 behavior). */
	agentStepsEnabled: boolean;
	/** Phase 10 / v1.5c R6 follow-up -- entity context the run is launched
	 * against. When set, runs.launch stamps (entity_type, entity_id) onto the
	 * new run so the Active Run card on the entity's detail page surfaces it.
	 * Undefined means the launch isn't bound to any single entity (the default
	 * /library row launch path). */
	entityContext?: { entityType: "listing"; entityId: string };
	/** Called on successful launch (after redirect) so the parent can close the
	 * panel state. Optional -- if the container manages its own close-on-launch,
	 * pass undefined. */
	onLaunched?: () => void;
}

export function LauncherForm({
	workflow,
	organizationSlug,
	agentStepsEnabled,
	entityContext,
	onLaunched,
}: LauncherFormProps) {
	const { user } = useSession();
	const currentUserId = user?.id ?? null;

	// Load the PUBLISHED version's bundle (kickoff fields + roles). The parent
	// pre-validated that latestPublishedVersionId is non-null via the resolver's
	// `run` action kind -- so the version exists + is published.
	const bundleQuery = useQuery(
		orpc.workflows.getVersionBundle.queryOptions({
			input: { versionId: workflow.latestPublishedVersionId },
		}),
	);
	const rolesQuery = useQuery(orpc.workflows.listRoles.queryOptions({ input: {} }));
	const membersQuery = useQuery(orpc.organizations.listMembers.queryOptions({ input: {} }));

	const launchMutation = useMutation(orpc.runs.launch.mutationOptions());

	// Per-field value map; per-role assignee map. Maps (not records) so write
	// semantics are explicit and we can pass them straight to the validation fn.
	// Per ADR-007 + D-023 (Phase 8 vendor picker), role assignees are now polymorphic
	// (user OR vendor+contact). The map's value type is AssigneeChoice | null; the
	// RoleAssigneePicker handles encode/decode at the UI boundary, and submit translates
	// each choice into the RoleAssignmentInput shape the server expects.
	const [fieldValues, setFieldValues] = useState<Map<string, unknown>>(new Map());
	const [roleAssignments, setRoleAssignments] = useState<Map<string, AssigneeChoice | null>>(
		new Map(),
	);
	// Phase 8 step 3 launch mode + agent selection. Default 'human' = no behavioral change
	// from the pre-Pass-B form. Mode + agentId are sent to runs.launch on submit.
	const [launchMode, setLaunchMode] = useState<LaunchMode>("human");
	const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
	const [submitError, setSubmitError] = useState<string | null>(null);
	/** Server-supplied missing-field hint when REQUIRED_KICKOFF_FIELD_MISSING fires.
	 * Lives separate from `submitError` so the per-field indicator can paint without
	 * the user having to re-read the banner. */
	const [serverMissingFieldKeys, setServerMissingFieldKeys] = useState<string[]>([]);

	const kickoffFields = useMemo(() => {
		if (!bundleQuery.data) return [];
		return bundleQuery.data.fields
			.filter((f) => f.stepId === null)
			.sort((a, b) => a.position - b.position);
	}, [bundleQuery.data]);

	const kickoffDescriptors: KickoffFieldDescriptor[] = useMemo(
		() =>
			kickoffFields.map((f) => ({
				key: f.key,
				label: f.label,
				isRequired: f.isRequired,
			})),
		[kickoffFields],
	);

	// Initiator pre-fill: the launching user is auto-assigned to any role flagged
	// isInitiator. Defaults applied once when the roles + user load; user can
	// override before submit. Initiator is always a user assignment (vendors can't be
	// initiators -- they don't have org accounts).
	useMemo(() => {
		if (!rolesQuery.data || !currentUserId) return;
		setRoleAssignments((prev) => {
			if (prev.size > 0) return prev; // honor existing edits
			const next = new Map<string, AssigneeChoice | null>();
			for (const role of rolesQuery.data ?? []) {
				next.set(
					role.id,
					role.isInitiator ? { kind: "user", userId: currentUserId } : null,
				);
			}
			return next;
		});
	}, [rolesQuery.data, currentUserId]);

	const clientMissing = findMissingRequiredKickoffFields(
		kickoffDescriptors,
		fieldValues,
	);
	// When mode != human, the agent picker must have a non-null selection. Otherwise the
	// submit would 400 with MODE_REQUIRES_AGENT -- block client-side instead of round-tripping.
	const modeNeedsAgent = launchMode !== "human";
	const missingAgent = modeNeedsAgent && !selectedAgentId;
	const submitDisabled =
		clientMissing.length > 0 ||
		missingAgent ||
		launchMutation.isPending ||
		!bundleQuery.data;

	const handleSubmit = async () => {
		if (!bundleQuery.data) return;
		setSubmitError(null);
		setServerMissingFieldKeys([]);

		// Build the kickoffValues record from the Map.
		const kickoffValues: Record<string, unknown> = {};
		for (const [key, value] of fieldValues.entries()) {
			kickoffValues[key] = value;
		}

		// Build the role assignments array. Unassigned roles are dropped per launchRun's
		// tolerance ("May omit roles not yet known; matching steps simply launch
		// unassigned"). The server's roleAssignmentSchema accepts either userId OR
		// (vendorId + vendorContactId); we discriminate on choice.kind here.
		const roleAssignmentsArr: Array<{
			roleId: string;
			userId?: string;
			vendorId?: string;
			vendorContactId?: string;
		}> = [];
		for (const [roleId, choice] of roleAssignments.entries()) {
			if (choice === null) continue;
			if (choice.kind === "user") {
				roleAssignmentsArr.push({ roleId, userId: choice.userId });
			} else {
				roleAssignmentsArr.push({
					roleId,
					vendorId: choice.vendorId,
					vendorContactId: choice.vendorContactId,
				});
			}
		}

		try {
			const result = await launchMutation.mutateAsync({
				workflowId: workflow.id,
				// PIN to the version the user filled. Closes the publish-during-fill
				// window -- if a v(N+1) lands while the user fills v(N)'s form, the
				// run still snapshots v(N) (D-018: published versions are immutable;
				// launchRun validates the pinned id is published).
				workflowVersionId: workflow.latestPublishedVersionId,
				kickoffValues,
				roleAssignments: roleAssignmentsArr,
				// Phase 8 step 3. Defaults to 'human' on the server too, but explicit
				// here keeps the wire payload self-describing for debugging.
				mode: launchMode,
				agentId: launchMode === "human" ? null : selectedAgentId,
				// Phase 10 / v1.5c R6 follow-up -- forward the entity context when
				// the launcher was opened from an entity-detail page. Stamped onto
				// the new run so the entity's Active Run card surfaces it.
				entityContext,
			});
			// Land in the Run view for the new run. Use window.location for a hard
			// nav so the run's data loads fresh (avoids any stale TanStack cache).
			onLaunched?.();
			window.location.href = `/${organizationSlug}/runs/${result.runId}`;
		} catch (err) {
			// REQUIRED_KICKOFF_FIELD_MISSING surfaces as a typed RunEngineError; the
			// procedure layer maps it to ORPCError BAD_REQUEST with `data.code` and
			// `data.missingFieldKeys`. We catch it explicitly + paint the inline
			// indicators (integrity #2 -- server is the gate, not client validation).
			const e = err as {
				message?: string;
				data?: { code?: string; missingFieldKeys?: string[] };
			};
			if (e.data?.code === "REQUIRED_KICKOFF_FIELD_MISSING" && e.data.missingFieldKeys) {
				setServerMissingFieldKeys(e.data.missingFieldKeys);
				setSubmitError(
					`Required field${e.data.missingFieldKeys.length === 1 ? "" : "s"} missing: ${e.data.missingFieldKeys.join(", ")}.`,
				);
				return;
			}
			setSubmitError(e.message ?? "Couldn't launch the run.");
		}
	};

	if (bundleQuery.isLoading || rolesQuery.isLoading || membersQuery.isLoading) {
		return <CenteredSpinner label="Loading launcher…" />;
	}
	if (bundleQuery.isError || !bundleQuery.data) {
		return (
			<div className="px-5 py-6 text-sm text-destructive">
				Couldn't load the workflow version: {bundleQuery.error?.message ?? "not found"}
			</div>
		);
	}

	const roles = rolesQuery.data ?? [];
	const members = membersQuery.data ?? [];
	// Workflow steps for the LaunchModePicker's preview. The bundle includes step rows
	// with type + position; we project just what the picker needs.
	const stepRows = bundleQuery.data.steps.map((s) => ({
		id: s.id,
		title: s.title,
		type: s.type,
		position: s.position,
	}));
	const fieldSaveStates: Map<string, FieldSaveState> = EMPTY_SAVE_STATES;
	const fieldErrors = new Map<string, string | null>(
		// Server-flagged missing required fields paint a per-field error indicator.
		serverMissingFieldKeys.map((k) => [k, "Required."]),
	);

	return (
		<div className="flex flex-col gap-5 px-5 py-4">
			<header>
				<h2 className="text-base font-medium">Launch {workflow.title}</h2>
				<p className="text-xs text-foreground/60 mt-1">
					Fill any required fields, then click Launch. The new run opens in the run
					view.
				</p>
			</header>

			{agentStepsEnabled && (
				<LaunchModePicker
					mode={launchMode}
					onChangeMode={(m) => {
						setLaunchMode(m);
						// Switching back to human clears the agent pick -- avoids stale state
						// being sent if the user toggles modes after picking an agent.
						if (m === "human") setSelectedAgentId(null);
					}}
					selectedAgentId={selectedAgentId}
					onChangeAgentId={setSelectedAgentId}
					steps={stepRows}
				/>
			)}

			{kickoffFields.length === 0 ? (
				<p className="text-xs text-foreground/60">
					No kickoff fields. Click Launch to start the run.
				</p>
			) : (
				<section>
					<p className="text-xs uppercase tracking-wide font-medium text-foreground/50 mb-2">
						Kickoff
					</p>
					<div className="flex flex-col gap-4">
						{kickoffFields.map((f) => (
							<RunFieldInput
								key={f.id}
								fieldKey={f.key}
								label={f.label}
								fieldType={f.fieldType as FieldType}
								config={f.config}
								isRequired={f.isRequired}
								value={fieldValues.get(f.key) ?? null}
								saveState={fieldSaveStates.get(f.key) ?? "idle"}
								errorMessage={fieldErrors.get(f.key) ?? null}
								disabled={launchMutation.isPending}
								onSave={(value) => {
									setFieldValues((prev) => {
										const next = new Map(prev);
										next.set(f.key, value);
										return next;
									});
									// Clear the server-missing indicator for this field as soon as
									// the user puts a value in -- they're trying to fix it.
									if (serverMissingFieldKeys.includes(f.key)) {
										setServerMissingFieldKeys((prev) =>
											prev.filter((k) => k !== f.key),
										);
									}
								}}
							/>
						))}
					</div>
				</section>
			)}

			{roles.length > 0 && (
				<section>
					<p className="text-xs uppercase tracking-wide font-medium text-foreground/50 mb-2">
						Roles
					</p>
					<div className="flex flex-col gap-3">
						{roles.map((role) => (
							<div key={role.id}>
								<label className="text-xs text-foreground/70 mb-1 inline-flex items-center gap-1.5">
									{role.name}
									{role.isInitiator && (
										<span className="text-[9px] uppercase tracking-wide font-medium rounded px-1 py-0.5 bg-muted text-muted-foreground">
											Initiator
										</span>
									)}
								</label>
								<RoleAssigneePicker
									value={roleAssignments.get(role.id) ?? null}
									onChange={(next) =>
										setRoleAssignments((prev) => {
											const m = new Map(prev);
											m.set(role.id, next);
											return m;
										})
									}
									members={members.map((m) => ({
										userId: m.userId,
										name: m.name,
										email: m.email,
									}))}
								/>
							</div>
						))}
					</div>
					<p className="text-[11px] text-foreground/50 mt-2">
						Roles are optional at launch — unassigned steps can be assigned in the
						run. Vendor assignees route the step to a specific contact via a
						tokenized portal link (no login required for the vendor).
					</p>
				</section>
			)}

			{submitError && (
				<Alert variant="error">
					<AlertDescription className="text-xs">{submitError}</AlertDescription>
				</Alert>
			)}

			<div className="pt-2 border-t border-border gap-3 flex items-center justify-end">
				<Button
					variant="primary"
					onClick={handleSubmit}
					disabled={submitDisabled}
					loading={launchMutation.isPending}
				>
					<Play className="size-3.5 mr-1.5" />
					Launch
				</Button>
			</div>
		</div>
	);
}

function CenteredSpinner({ label }: { label: string }) {
	return (
		<div className="flex items-center justify-center gap-3 py-12 text-foreground/60">
			<Spinner className="size-4" /> {label}
		</div>
	);
}

const EMPTY_SAVE_STATES: Map<string, FieldSaveState> = new Map();

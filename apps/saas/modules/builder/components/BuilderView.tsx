"use client";

// Workflow Builder canvas (Pass 2 of UX_SPEC §4.3). Two-region layout fills the
// mode="author" slot RunStepList + RunStepPanel already reserve. Preview mode pivots
// the canvas into a no-side-effect dry render via the preview adapter (no run row, no
// completeStep calls, no field saves).
//
// Routing intent:
//   - The page loads `workflows.get(workflowId)` to discover the current draft (if any)
//     and the latest published version.
//   - If there's a draft, we open the draft in author mode.
//   - If there's only a published version, we open it in view mode + show an Edit
//     button. Clicking Edit calls `workflows.editPublished` which RESUMES the existing
//     draft (if any) or FORKS a new one (D-018). Either way we refetch and rerender.
//
// Author-mode mutations route through the split optimistic strategy in
// builder-mutations.ts (reorder + edit optimistic; create + delete + publish await
// server then invalidate).

import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Spinner } from "@virn/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

import type { FieldType, RunStatus, RunStepStatus, StepType } from "@runs/types";
import { RunStepList, type RunStepListDefinitionStep, type RunStepListItem, type RunStepListSection } from "@runs/components/RunStepList";
import { RunStepPanel, type RunStepPanelFieldRow } from "@runs/components/RunStepPanel";

import type { FieldSaveState as _FieldSaveState } from "@runs/types";
import { buildGatingSnapshot } from "@shared/lib/gating";

import {
	useAddStepDependency,
	useApproveReview,
	useCreateField,
	useCreateSection,
	useCreateStep,
	useCreateWorkflowRole,
	useDeleteField,
	useDeleteStep,
	useDiscardDraft,
	useEditPublished,
	usePublishVersion,
	useRegenerateStep,
	useRemoveStepDependency,
	useRenameField,
	useReorderSteps,
	useSendBackToDraft,
	useSubmitForReview,
	useUpdateField,
	useUpdateStep,
} from "../lib/builder-mutations";
import { computePaletteGates, type PaletteGates } from "../lib/capability-gates";
import { buildPreviewFromBundle } from "../lib/preview-adapter";
import { PREVIEW_NOOP_COMPLETE, PREVIEW_NOOP_SET_FIELD } from "../lib/preview-callbacks";
import type { VersionEditBundleResponse } from "../lib/types";
import { BuilderConfigPanel } from "./BuilderConfigPanel";
import { BuilderTopBar } from "./BuilderTopBar";
import { FieldConfigForm, type FieldReferencer } from "./FieldConfigForm";
import { KickoffPanel } from "./KickoffPanel";
import { KickoffRailEntry } from "./KickoffRailEntry";
import { StepConfigForm } from "./StepConfigForm";
import { TemplateVariablesSidebar } from "./TemplateVariablesSidebar";
import { WorkflowConfigForm } from "./WorkflowConfigForm";

interface BuilderViewProps {
	workflowId: string;
	/** Active org slug. Threaded through to workflow-level config surfaces so the
	 * Scope panel's "no entity sets yet" empty-state can deep-link to
	 * /<organizationSlug>/library/entity-sets. */
	organizationSlug: string;
	/** True when the caller is admin/owner of the active org. Resolved server-side via
	 * the gating snapshot in the page (UX_SPEC §2 admin-vs-member axis). Non-admin
	 * members see view mode regardless of draft state -- the API's adminOrgProcedure
	 * refuses non-admin writes anyway, but the UI must not show controls that 403. */
	isAdminOrOwner: boolean;
	/** The caller's preset role (Owner/Admin/Builder/Operator/Reviewer). Passed
	 * through so the client can rebuild a GatingSnapshot for the palette-gating
	 * helpers (see capability-gates.ts). */
	role: import("@shared/lib/nav").RoleId;
	/** Capability keys currently enabled for the active org. Serialized as an array
	 * because Set doesn't cross the server/client boundary; rebuilt into a Set in
	 * the snapshot reconstruction below. */
	enabledCapabilityKeys: readonly string[];
	/** Phase 9.5g (PRD §6.6) -- when true, "Publish" becomes "Submit for review" and
	 * the in_review state surfaces Approve / Send-back actions. The flag is read
	 * server-side from the org row (Better Auth's ActiveOrganization doesn't include
	 * custom columns). */
	requireConciergeReview: boolean;
}

export function BuilderView({
	workflowId,
	organizationSlug,
	isAdminOrOwner,
	role,
	enabledCapabilityKeys,
	requireConciergeReview,
}: BuilderViewProps) {
	const queryClient = useQueryClient();
	const workflowQuery = useQuery(orpc.workflows.get.queryOptions({ input: { workflowId } }));

	// Decide which version to open:
	//   - currentDraft if present (author mode);
	//   - latestPublished otherwise (view mode + Edit button).
	const activeVersion = useMemo(() => {
		if (!workflowQuery.data) return null;
		return workflowQuery.data.currentDraft ?? workflowQuery.data.latestPublished ?? null;
	}, [workflowQuery.data]);

	const bundleQuery = useQuery({
		...orpc.workflows.getVersionBundle.queryOptions({
			input: { versionId: activeVersion?.id ?? "" },
		}),
		enabled: !!activeVersion,
	});

	const [previewActive, setPreviewActive] = useState(false);
	const [topLevelError, setTopLevelError] = useState<string | null>(null);

	const editPublishedMutation = useEditPublished();
	const publishMutation = usePublishVersion();
	const discardMutation = useDiscardDraft();
	// Phase 9.5g review mutations.
	const submitForReviewMutation = useSubmitForReview();
	const approveReviewMutation = useApproveReview();
	const sendBackToDraftMutation = useSendBackToDraft();
	// Phase 9.5 R2 -- Enabled/Disabled toggle. Single-field workflows.update;
	// onSuccess refetches the workflow query so the top bar reflects the new
	// state (and so downstream surfaces that read isActive stay consistent).
	const toggleActiveMutation = useMutation({
		...orpc.workflows.update.mutationOptions(),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: orpc.workflows.get.queryKey({ input: { workflowId } }),
			});
		},
		onError: (err) =>
			setTopLevelError(
				err instanceof Error
					? err.message
					: "Couldn't change Enabled/Disabled state.",
			),
	});
	const handleToggleActive = (next: boolean) => {
		setTopLevelError(null);
		toggleActiveMutation.mutate({ workflowId, isActive: next });
	};

	// Reconstruct the gating snapshot from the serialized props + derive the
	// per-affordance palette gates the config forms read. Memoized so the gates
	// object is stable across renders (cheap, but the config forms re-render
	// pointlessly without it).
	const gates = useMemo<PaletteGates>(() => {
		const snapshot = buildGatingSnapshot(role, enabledCapabilityKeys);
		return computePaletteGates(snapshot);
	}, [role, enabledCapabilityKeys]);

	if (workflowQuery.isLoading) {
		return <CenteredSpinner label="Loading workflow…" />;
	}
	if (workflowQuery.isError || !workflowQuery.data) {
		return (
			<ErrorState
				message={workflowQuery.error?.message ?? "Workflow not found."}
			/>
		);
	}
	if (!activeVersion) {
		return (
			<ErrorState message="This workflow has no versions yet. Re-create it from the Library." />
		);
	}
	if (bundleQuery.isLoading || !bundleQuery.data) {
		return <CenteredSpinner label="Loading canvas…" />;
	}
	if (bundleQuery.isError) {
		return (
			<ErrorState
				message={bundleQuery.error?.message ?? "Couldn't load workflow version."}
			/>
		);
	}

	const bundle = bundleQuery.data as VersionEditBundleResponse;
	const versionStatus = bundle.version.status;
	const isDraft = versionStatus === "draft";
	const forkedFromVersionNumber = isDraft
		? workflowQuery.data.latestPublished?.versionNumber ?? null
		: null;

	const handleEdit = async () => {
		setTopLevelError(null);
		try {
			const result = await editPublishedMutation.mutateAsync({ workflowId });
			// Either a fresh fork or a resumed draft -- refetch the workflow header so the
			// new currentDraft surfaces, which switches us into the draft view.
			await queryClient.invalidateQueries({
				queryKey: orpc.workflows.get.queryKey({ input: { workflowId } }),
			});
			// Also prefetch the new draft's bundle.
			await queryClient.invalidateQueries({
				queryKey: orpc.workflows.getVersionBundle.queryKey({
					input: { versionId: result.draftVersionId },
				}),
			});
		} catch (err) {
			setTopLevelError(err instanceof Error ? err.message : "Couldn't open the editor.");
		}
	};

	const handlePublish = async () => {
		setTopLevelError(null);
		try {
			await publishMutation.mutateAsync({ versionId: bundle.version.id });
			await queryClient.invalidateQueries({
				queryKey: orpc.workflows.get.queryKey({ input: { workflowId } }),
			});
		} catch (err) {
			setTopLevelError(err instanceof Error ? err.message : "Couldn't publish.");
		}
	};

	const handleDiscard = async () => {
		setTopLevelError(null);
		try {
			await discardMutation.mutateAsync({ versionId: bundle.version.id });
			await queryClient.invalidateQueries({
				queryKey: orpc.workflows.get.queryKey({ input: { workflowId } }),
			});
		} catch (err) {
			setTopLevelError(err instanceof Error ? err.message : "Couldn't discard the draft.");
		}
	};

	// Phase 9.5g review-state handlers. All invalidate workflows.get so the BuilderView
	// re-renders against the post-transition state (which flips the top-bar buttons).
	const refetchWorkflow = async () => {
		await queryClient.invalidateQueries({
			queryKey: orpc.workflows.get.queryKey({ input: { workflowId } }),
		});
		if (activeVersion?.id) {
			await queryClient.invalidateQueries({
				queryKey: orpc.workflows.getVersionBundle.queryKey({
					input: { versionId: activeVersion.id },
				}),
			});
		}
	};

	const handleSubmitForReview = async () => {
		setTopLevelError(null);
		try {
			await submitForReviewMutation.mutateAsync({ workflowId });
			await refetchWorkflow();
		} catch (err) {
			setTopLevelError(
				err instanceof Error ? err.message : "Couldn't submit for review.",
			);
		}
	};

	const handleApproveReview = async () => {
		setTopLevelError(null);
		try {
			await approveReviewMutation.mutateAsync({ workflowId });
			await refetchWorkflow();
		} catch (err) {
			setTopLevelError(err instanceof Error ? err.message : "Couldn't approve.");
		}
	};

	const handleSendBackToDraft = async () => {
		setTopLevelError(null);
		try {
			await sendBackToDraftMutation.mutateAsync({ workflowId, comment: null });
			await refetchWorkflow();
		} catch (err) {
			setTopLevelError(
				err instanceof Error ? err.message : "Couldn't send back to draft.",
			);
		}
	};

	const workflowReviewState = (workflowQuery.data.workflow.reviewState ?? "draft") as
		| "draft"
		| "in_review"
		| "published"
		| "archived";

	return (
		<BuilderInner
			bundle={bundle}
			workflowId={workflowId}
			workflowTitle={workflowQuery.data.workflow.title}
			workflowEntitySetIds={workflowQuery.data.workflow.entitySetIds ?? []}
			workflowIsActive={workflowQuery.data.workflow.isActive ?? true}
			workflowReviewState={workflowReviewState}
			aiAuthoring={workflowQuery.data.aiAuthoring ?? null}
			requireConciergeReview={requireConciergeReview}
			organizationSlug={organizationSlug}
			forkedFromVersionNumber={forkedFromVersionNumber}
			isDraft={isDraft}
			isAdminOrOwner={isAdminOrOwner}
			gates={gates}
			previewActive={previewActive}
			onTogglePreview={() => setPreviewActive((p) => !p)}
			topLevelError={topLevelError}
			editPending={editPublishedMutation.isPending}
			onEdit={handleEdit}
			publishPending={publishMutation.isPending}
			onPublish={handlePublish}
			discardPending={discardMutation.isPending}
			onDiscard={handleDiscard}
			submitForReviewPending={submitForReviewMutation.isPending}
			onSubmitForReview={handleSubmitForReview}
			approveReviewPending={approveReviewMutation.isPending}
			onApproveReview={handleApproveReview}
			sendBackToDraftPending={sendBackToDraftMutation.isPending}
			onSendBackToDraft={handleSendBackToDraft}
			toggleActivePending={toggleActiveMutation.isPending}
			onToggleActive={handleToggleActive}
		/>
	);
}

// ---------------------------------------------------------------------------
// Inner -- splits so author-mode hooks only mount when we actually have a draft.
// Otherwise `useUpdateStep` etc. would mount with an empty versionId.
// ---------------------------------------------------------------------------

interface BuilderInnerProps {
	bundle: VersionEditBundleResponse;
	workflowId: string;
	workflowTitle: string;
	/** Current workflow-level entity-set scope (Phase 9.5e). Empty array = applies-to-all. */
	workflowEntitySetIds: string[];
	/** Phase 9.5 R2 -- current workflow.isActive value. Drives the Enabled/Disabled
	 * switch state in the top bar. Default true mirrors the schema default. */
	workflowIsActive: boolean;
	/** Phase 9.5g (PRD §6.6) -- editorial review state. Drives top-bar Publish vs
	 * Submit-for-review vs Approve+SendBack buttons. */
	workflowReviewState: "draft" | "in_review" | "published" | "archived";
	requireConciergeReview: boolean;
	/** Phase 12.1 -- AI authoring provenance surfaced from getWorkflowWithVersions.
	 * null for hand-authored or pack-installed workflows. */
	aiAuthoring: { promptId: string; model: string; createdAt: string | Date } | null;
	organizationSlug: string;
	forkedFromVersionNumber: number | null;
	isDraft: boolean;
	isAdminOrOwner: boolean;
	gates: PaletteGates;
	previewActive: boolean;
	onTogglePreview: () => void;
	topLevelError: string | null;
	editPending: boolean;
	onEdit: () => void;
	publishPending: boolean;
	onPublish: () => void;
	discardPending: boolean;
	onDiscard: () => void;
	// Phase 9.5g
	submitForReviewPending: boolean;
	onSubmitForReview: () => void;
	approveReviewPending: boolean;
	onApproveReview: () => void;
	sendBackToDraftPending: boolean;
	onSendBackToDraft: () => void;
	// Phase 9.5 R2 -- Enabled/Disabled toggle on the top bar.
	toggleActivePending: boolean;
	onToggleActive: (next: boolean) => void;
}

function BuilderInner({
	bundle,
	workflowId,
	workflowTitle,
	workflowEntitySetIds,
	workflowIsActive,
	workflowReviewState,
	requireConciergeReview,
	aiAuthoring,
	organizationSlug,
	forkedFromVersionNumber,
	isDraft,
	isAdminOrOwner,
	gates,
	previewActive,
	onTogglePreview,
	topLevelError,
	editPending,
	onEdit,
	publishPending,
	onPublish,
	discardPending,
	onDiscard,
	submitForReviewPending,
	onSubmitForReview,
	approveReviewPending,
	onApproveReview,
	sendBackToDraftPending,
	onSendBackToDraft,
	toggleActivePending,
	onToggleActive,
}: BuilderInnerProps) {
	// Mutation hooks (mount unconditionally; they no-op if not invoked).
	const mutArgs = { versionId: bundle.version.id };
	const createSection = useCreateSection(mutArgs);
	const createStep = useCreateStep(mutArgs);
	const createField = useCreateField(mutArgs);
	const updateStep = useUpdateStep(mutArgs);
	const regenerateStep = useRegenerateStep(mutArgs);
	// D-040 regenerate per-call error, cleared by the next invocation. Kept
	// here rather than in StepConfigForm because the same form re-mounts when
	// the operator selects a different step, and we want stale errors to clear
	// then too.
	const [regenerateError, setRegenerateError] = useState<string | null>(null);
	const updateField = useUpdateField(mutArgs);
	const renameField = useRenameField(mutArgs);
	const deleteStep = useDeleteStep(mutArgs);
	const deleteField = useDeleteField(mutArgs);
	const reorderSteps = useReorderSteps(mutArgs);
	const addDep = useAddStepDependency(mutArgs);
	const createRole = useCreateWorkflowRole();
	const removeDep = useRemoveStepDependency(mutArgs);
	// Workflow roles for the step assignee picker. Org-level query, mounted once.
	const rolesQuery = useQuery(orpc.workflows.listRoles.queryOptions({ input: {} }));

	// Author mode is on when we're an admin/owner AND looking at a draft AND preview
	// isn't engaged. Non-admin members never enter author mode -- the API's
	// adminOrgProcedure would 403 on every write, so we render view mode and hide
	// the affordances that would silently fail. Preview is admin-only too (it's an
	// authoring rehearsal, not an operator view).
	const authorActive = isAdminOrOwner && isDraft && !previewActive;
	const previewAvailable = isAdminOrOwner && isDraft;
	const mode: "author" | "preview" | "view" = authorActive
		? "author"
		: previewActive && previewAvailable
			? "preview"
			: "view";

	const [activeStepId, setActiveStepId] = useState<string | null>(() => bundle.steps[0]?.id ?? null);
	// Kickoff selection is mutually exclusive with a step selection -- the canvas
	// has one "active editor target" at a time (UX_SPEC §4.3 rail = kickoff + sections
	// + steps; selecting any of them swaps the center editor). Selecting kickoff clears
	// activeStepId; selecting a step clears kickoffActive. The wiring below enforces
	// that pairwise.
	const [kickoffActive, setKickoffActive] = useState(false);

	// Config-panel focus. Mutually exclusive: either a step's settings are open, OR
	// a field's, OR the workflow-level settings (Phase 9.5e: Scope panel), OR the
	// panel's closed. (No "kickoff" kind here -- the kickoff section's *form* lives in
	// the center editor, not in the slide-in panel; individual kickoff field config
	// opens via { kind: "field" } same as step fields.)
	const [panelFocus, setPanelFocus] = useState<
		| { kind: "step"; stepId: string }
		| { kind: "field"; fieldId: string }
		| { kind: "workflow" }
		| null
	>(null);
	// Server-supplied referencer list when the last rename refused with
	// FIELD_KEY_LOCKED. Cleared on successful rename or panel close.
	const [keyRenameRefs, setKeyRenameRefs] = useState<FieldReferencer[] | null>(null);
	// Phase 12.2 -- parallel state for FIELD_TYPE_CHANGE_LOCKED. Cleared on
	// successful change or panel close (same lifecycle as keyRenameRefs).
	const [typeChangeRefs, setTypeChangeRefs] = useState<FieldReferencer[] | null>(null);

	// Default to first step (or to the same step across mode toggles when it survives).
	const activeStep = useMemo(() => {
		if (mode === "preview") {
			// In preview, ids are synthetic; map by the underlying definition stepId.
			const previewActiveId =
				activeStepId && bundle.steps.find((s) => s.id === activeStepId) ? `preview_${activeStepId}` : null;
			return previewActiveId;
		}
		return activeStepId;
	}, [activeStepId, bundle.steps, mode]);

	if (mode === "preview") {
		// previewAvailable is implied by `mode === "preview"`, so admin-gating on
		// publish/discard here is the same as on author mode below.
		return (
			<BuilderShell
				bundle={bundle}
				workflowTitle={workflowTitle}
				forkedFromVersionNumber={forkedFromVersionNumber}
				isDraft={isDraft}
				isAdminOrOwner={isAdminOrOwner}
				previewAvailable={previewAvailable}
				previewActive
				onTogglePreview={onTogglePreview}
				canEdit={false}
				editPending={editPending}
				onEdit={onEdit}
				canPublish={isAdminOrOwner && isDraft}
				publishPending={publishPending}
				onPublish={onPublish}
				canDiscard={isAdminOrOwner && isDraft}
				discardPending={discardPending}
				onDiscard={onDiscard}
				aiAuthoring={aiAuthoring}
				topLevelError={topLevelError}
			>
				<PreviewBody
					bundle={bundle}
					workflowTitle={workflowTitle}
					activeRunStepId={activeStep}
					onSelectStep={(id) => {
						// Map preview synthetic id back to definition stepId for cross-mode persistence.
						setActiveStepId(id.replace(/^preview_/, ""));
					}}
				/>
			</BuilderShell>
		);
	}

	if (mode === "view") {
		// View mode is reached two ways:
		//   - admin looking at a published version (no draft) -> Edit button visible
		//     (clicking calls editPublished -> draft fork/resume).
		//   - non-admin member looking at either a draft or published -> no Edit
		//     button. They can see what's authored; they can't act.
		// Either way: no author affordances, no Publish/Discard.
		const canEdit = isAdminOrOwner && !isDraft;
		return (
			<BuilderShell
				bundle={bundle}
				workflowTitle={workflowTitle}
				forkedFromVersionNumber={forkedFromVersionNumber}
				isDraft={isDraft}
				isAdminOrOwner={isAdminOrOwner}
				previewAvailable={previewAvailable}
				previewActive={false}
				onTogglePreview={onTogglePreview}
				canEdit={canEdit}
				editPending={editPending}
				onEdit={onEdit}
				canPublish={false}
				publishPending={publishPending}
				onPublish={onPublish}
				canDiscard={false}
				discardPending={discardPending}
				onDiscard={onDiscard}
				aiAuthoring={aiAuthoring}
				topLevelError={topLevelError}
			>
				<ViewBody
					bundle={bundle}
					activeStepId={activeStepId}
					onSelectStep={setActiveStepId}
				/>
			</BuilderShell>
		);
	}

	// AUTHOR -- only reached when isAdminOrOwner && isDraft && !previewActive.
	// Kickoff fields = field.stepId IS NULL (collected at run start).
	// Step fields = field.stepId === activeStepId.
	const kickoffFields = bundle.fields.filter((f) => f.stepId === null);
	const fieldsForStep = activeStepId
		? bundle.fields.filter((f) => f.stepId === activeStepId)
		: [];

	return (
		<BuilderShell
			bundle={bundle}
			workflowTitle={workflowTitle}
			forkedFromVersionNumber={forkedFromVersionNumber}
			isDraft
			isAdminOrOwner={isAdminOrOwner}
			previewAvailable={previewAvailable}
			previewActive={false}
			onTogglePreview={onTogglePreview}
			canEdit={false}
			editPending={editPending}
			onEdit={onEdit}
			canPublish
			publishPending={publishPending}
			onPublish={onPublish}
			canDiscard
			discardPending={discardPending}
			onDiscard={onDiscard}
			onConfigureWorkflow={() => {
				setKeyRenameRefs(null);
				setTypeChangeRefs(null);
				setPanelFocus({ kind: "workflow" });
			}}
			reviewState={workflowReviewState}
			requireConciergeReview={requireConciergeReview}
			submitForReviewPending={submitForReviewPending}
			onSubmitForReview={onSubmitForReview}
			approveReviewPending={approveReviewPending}
			onApproveReview={onApproveReview}
			sendBackToDraftPending={sendBackToDraftPending}
			onSendBackToDraft={onSendBackToDraft}
			aiAuthoring={aiAuthoring}
			isActive={workflowIsActive}
			toggleActivePending={toggleActivePending}
			onToggleActive={onToggleActive}
			entitySetIdsCount={workflowEntitySetIds.length}
			topLevelError={topLevelError}
		>
			<div className="flex flex-1 min-h-0">
				<div className="flex-1 min-w-0 flex">
					<AuthorBody
						bundle={bundle}
						activeStepId={activeStepId}
						kickoffActive={kickoffActive}
						kickoffFields={kickoffFields}
						onSelectStep={(id) => {
							setActiveStepId(id);
							setKickoffActive(false); // mutually exclusive with kickoff
							if (panelFocus?.kind === "field") setPanelFocus(null);
						}}
						onSelectKickoff={() => {
							setKickoffActive(true);
							setActiveStepId(null); // mutually exclusive with step
							if (panelFocus?.kind === "field") setPanelFocus(null);
						}}
						fieldsForStep={fieldsForStep}
						createSection={createSection}
						createStep={createStep}
						createField={createField}
						updateStep={updateStep}
						updateField={updateField}
						deleteStep={deleteStep}
						deleteField={deleteField}
						reorderSteps={reorderSteps}
						onConfigureStep={(stepId) => {
							setKeyRenameRefs(null);
							setTypeChangeRefs(null);
							setPanelFocus({ kind: "step", stepId });
						}}
						onConfigureField={(fieldId) => {
							setKeyRenameRefs(null);
							setTypeChangeRefs(null);
							setPanelFocus({ kind: "field", fieldId });
						}}
					/>
				</div>

				<BuilderConfigPanel
					open={panelFocus !== null}
					title={
						panelFocus?.kind === "step"
							? "Step settings"
							: panelFocus?.kind === "field"
								? "Field settings"
								: panelFocus?.kind === "workflow"
									? "Workflow settings"
									: ""
					}
					onClose={() => {
						setPanelFocus(null);
						setKeyRenameRefs(null);
						setTypeChangeRefs(null);
					}}
				>
					{panelFocus?.kind === "step" &&
						(() => {
							const step = bundle.steps.find((s) => s.id === panelFocus.stepId);
							if (!step) return null;
							return (
								<StepConfigForm
									step={step}
									allSteps={bundle.steps}
									allFields={bundle.fields}
									dependencies={bundle.dependencies}
									workflowRoles={rolesQuery.data ?? []}
									gates={gates}
									onChangeType={(type) =>
										updateStep.mutate({ stepId: step.id, type })
									}
									onChangeAssignedRole={(roleId) =>
										updateStep.mutate({ stepId: step.id, assignedRoleId: roleId })
									}
									onChangeDueRule={({
										dueType,
										dueOffsetDays,
										dueAnchorStepId,
										dueSourceFieldId,
									}) =>
										updateStep.mutate({
											stepId: step.id,
											dueType,
											dueOffsetDays,
											// Phase 12.2 -- forward refs so the server can clear or
											// set them in the same round-trip as the dueType change.
											dueAnchorStepId,
											dueSourceFieldId,
										})
									}
									onToggleRequired={(value) =>
										updateStep.mutate({ stepId: step.id, isRequired: value })
									}
									onToggleStopTask={(value) =>
										updateStep.mutate({ stepId: step.id, isStopTask: value })
									}
									onAddDependency={(dependsOnStepId) =>
										addDep.mutate({ stepId: step.id, dependsOnStepId })
									}
									onRemoveDependency={(dependsOnStepId) =>
										removeDep.mutate({ stepId: step.id, dependsOnStepId })
									}
									onCreateRole={async (name) => {
										// AWAIT -- the server owns the cuid. Returns the new role's id
										// so the form can auto-select it.
										return await createRole.mutateAsync({ name });
									}}
									onRegenerateStep={(refinementPrompt) => {
										setRegenerateError(null);
										regenerateStep.mutate(
											{ stepId: step.id, refinementPrompt },
											{
												onError: (err) =>
													setRegenerateError(
														err instanceof Error
															? err.message
															: "Couldn't regenerate this step.",
													),
											},
										);
									}}
									regenerateStepPending={regenerateStep.isPending}
									regenerateStepError={regenerateError}
								/>
							);
						})()}

					{panelFocus?.kind === "field" &&
						(() => {
							const f = bundle.fields.find((x) => x.id === panelFocus.fieldId);
							if (!f) return null;
							return (
								<FieldConfigForm
									field={f}
									gates={gates}
									keyRenameRefusalRefs={keyRenameRefs}
									keyRenamePending={renameField.isPending}
									typeChangeRefusalRefs={typeChangeRefs}
									onChangeLabel={(label) =>
										updateField.mutate({ fieldId: f.id, label })
									}
									onChangeKey={(key) => {
										setKeyRenameRefs(null);
										renameField.mutate(
											{ fieldId: f.id, key },
											{
												onError: (err) => {
													const data = (
														err as { data?: { code?: string; referencers?: FieldReferencer[] } }
													).data;
													if (data?.code === "FIELD_KEY_LOCKED" && data.referencers) {
														setKeyRenameRefs(data.referencers);
													}
												},
											},
										);
									}}
									onChangeType={(fieldType) => {
										// Clear any prior refusal before retrying so the form
										// doesn't show a stale "clear references" hint while the
										// new mutation is in flight.
										setTypeChangeRefs(null);
										updateField.mutate(
											{ fieldId: f.id, fieldType },
											{
												onError: (err) => {
													const data = (
														err as {
															data?: { code?: string; referencers?: FieldReferencer[] };
														}
													).data;
													if (data?.code === "FIELD_TYPE_CHANGE_LOCKED" && data.referencers) {
														setTypeChangeRefs(data.referencers);
													}
												},
											},
										);
									}}
									onChangeRequired={(isRequired) =>
										updateField.mutate({ fieldId: f.id, isRequired })
									}
									onChangeOptions={(options) =>
										updateField.mutate({
											fieldId: f.id,
											config: { ...(f.config ?? {}), options },
										})
									}
									onChangeHelpText={(helpText) => {
										const next = { ...(f.config ?? {}) };
										if (helpText === null || helpText.length === 0) {
											delete (next as Record<string, unknown>).helpText;
										} else {
											(next as Record<string, unknown>).helpText = helpText;
										}
										updateField.mutate({ fieldId: f.id, config: next });
									}}
									onChangeDataSetKey={(key) => {
										const next = { ...(f.config ?? {}) };
										if (key === null) {
											delete (next as Record<string, unknown>).dataSetKey;
										} else {
											(next as Record<string, unknown>).dataSetKey = key;
										}
										updateField.mutate({ fieldId: f.id, config: next });
									}}
								/>
							);
						})()}

					{/* Phase 9.5e -- workflow-level settings (Scope panel + future extensions). */}
					{panelFocus?.kind === "workflow" && (
						<WorkflowConfigForm
							workflowId={workflowId}
							workflowTitle={workflowTitle}
							entitySetIds={workflowEntitySetIds}
							organizationSlug={organizationSlug}
							disabled={!isAdminOrOwner || !isDraft}
						/>
					)}
				</BuilderConfigPanel>
			</div>
		</BuilderShell>
	);
}

// ---------------------------------------------------------------------------
// Shell -- wraps top bar + two-region layout. Body is mode-specific.
// ---------------------------------------------------------------------------

interface BuilderShellProps {
	bundle: VersionEditBundleResponse;
	workflowTitle: string;
	forkedFromVersionNumber: number | null;
	isDraft: boolean;
	isAdminOrOwner: boolean;
	previewAvailable: boolean;
	previewActive: boolean;
	onTogglePreview: () => void;
	canEdit: boolean;
	editPending: boolean;
	onEdit: () => void;
	canPublish: boolean;
	publishPending: boolean;
	onPublish: () => void;
	canDiscard: boolean;
	discardPending: boolean;
	onDiscard: () => void;
	/** Phase 9.5e -- optional callback for the top-bar gear that opens the workflow
	 * settings panel. Threaded through from BuilderInner; view/preview shells omit it. */
	onConfigureWorkflow?: () => void;
	// Phase 9.5g -- review-state controls (only meaningful in author mode).
	reviewState?: "draft" | "in_review" | "published" | "archived";
	requireConciergeReview?: boolean;
	submitForReviewPending?: boolean;
	onSubmitForReview?: () => void;
	approveReviewPending?: boolean;
	onApproveReview?: () => void;
	sendBackToDraftPending?: boolean;
	onSendBackToDraft?: () => void;
	/** Phase 12.1 -- AI authoring provenance; pass-through to BuilderTopBar. */
	aiAuthoring?: { model: string; createdAt: string | Date } | null;
	/** Phase 9.5 R2 -- Enabled/Disabled toggle + Scope chip pass-throughs. All
	 * optional so view-mode / preview shells (which don't write) can omit them. */
	isActive?: boolean;
	toggleActivePending?: boolean;
	onToggleActive?: (next: boolean) => void;
	entitySetIdsCount?: number;
	topLevelError: string | null;
	children: React.ReactNode;
}

function BuilderShell({
	bundle,
	workflowTitle,
	forkedFromVersionNumber,
	isDraft,
	isAdminOrOwner,
	previewAvailable,
	previewActive,
	onTogglePreview,
	canEdit,
	editPending,
	onEdit,
	canPublish,
	publishPending,
	onPublish,
	canDiscard,
	discardPending,
	onDiscard,
	onConfigureWorkflow,
	reviewState,
	requireConciergeReview,
	submitForReviewPending,
	onSubmitForReview,
	approveReviewPending,
	onApproveReview,
	sendBackToDraftPending,
	onSendBackToDraft,
	aiAuthoring,
	isActive,
	toggleActivePending,
	onToggleActive,
	entitySetIdsCount,
	topLevelError,
	children,
}: BuilderShellProps) {
	return (
		<div className="rounded-lg border border-border bg-background overflow-hidden flex flex-col h-full min-h-0">
			<BuilderTopBar
				workflowTitle={workflowTitle}
				versionNumber={bundle.version.versionNumber}
				versionStatus={bundle.version.status}
				forkedFromVersionNumber={forkedFromVersionNumber}
				previewAvailable={previewAvailable}
				previewActive={previewActive}
				onTogglePreview={onTogglePreview}
				canEdit={canEdit}
				editPending={editPending}
				onEdit={onEdit}
				canPublish={canPublish}
				publishPending={publishPending}
				onPublish={onPublish}
				canDiscard={canDiscard}
				discardPending={discardPending}
				onDiscard={onDiscard}
				onConfigureWorkflow={onConfigureWorkflow}
				reviewState={reviewState}
				requireConciergeReview={requireConciergeReview}
				submitForReviewPending={submitForReviewPending}
				onSubmitForReview={onSubmitForReview}
				approveReviewPending={approveReviewPending}
				onApproveReview={onApproveReview}
				sendBackToDraftPending={sendBackToDraftPending}
				onSendBackToDraft={onSendBackToDraft}
				aiAuthoring={aiAuthoring}
				isActive={isActive}
				toggleActivePending={toggleActivePending}
				onToggleActive={onToggleActive}
				entitySetIdsCount={entitySetIdsCount}
			/>
			{topLevelError && (
				<div className="px-4 py-2">
					<Alert variant="error">
						<AlertDescription className="text-xs">{topLevelError}</AlertDescription>
					</Alert>
				</div>
			)}
			{!isAdminOrOwner && (
				<div className="px-4 py-2">
					<Alert>
						<AlertDescription className="text-xs">
							You're viewing this workflow in read-only mode. Editing and publishing
							require admin or owner permission.
						</AlertDescription>
					</Alert>
				</div>
			)}
			{isAdminOrOwner && !isDraft && !previewActive && (
				<div className="px-4 py-2">
					<Alert>
						<AlertDescription className="text-xs">
							You're viewing a published version. Click <strong>Edit</strong> to open the
							draft (resumes an existing draft or forks a new one — in-flight runs are
							untouched either way).
						</AlertDescription>
					</Alert>
				</div>
			)}
			{children}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Mode bodies
// ---------------------------------------------------------------------------

function AuthorBody({
	bundle,
	activeStepId,
	kickoffActive,
	kickoffFields,
	onSelectStep,
	onSelectKickoff,
	fieldsForStep,
	createSection,
	createStep,
	createField,
	updateStep,
	updateField,
	deleteStep,
	deleteField,
	reorderSteps,
	onConfigureStep,
	onConfigureField,
}: {
	bundle: VersionEditBundleResponse;
	activeStepId: string | null;
	/** When true, the kickoff form is the active editor target (mutually exclusive
	 * with activeStepId). UX_SPEC §4.3: kickoff form is a peer of sections + steps
	 * in the rail; the center swaps to KickoffPanel when this is set. */
	kickoffActive: boolean;
	/** Kickoff field rows (field.stepId === null). Sorted by position inside the
	 * panel; passed in pre-filtered by BuilderInner so this component doesn't
	 * re-derive. */
	kickoffFields: VersionEditBundleResponse["fields"];
	onSelectStep: (stepId: string | null) => void;
	/** Select the kickoff form as the active editor target. Parent ensures
	 * mutually-exclusive selection (clears activeStepId). */
	onSelectKickoff: () => void;
	fieldsForStep: VersionEditBundleResponse["fields"];
	createSection: ReturnType<typeof useCreateSection>;
	createStep: ReturnType<typeof useCreateStep>;
	createField: ReturnType<typeof useCreateField>;
	updateStep: ReturnType<typeof useUpdateStep>;
	updateField: ReturnType<typeof useUpdateField>;
	deleteStep: ReturnType<typeof useDeleteStep>;
	deleteField: ReturnType<typeof useDeleteField>;
	reorderSteps: ReturnType<typeof useReorderSteps>;
	/** Opens the slide-in panel for per-step config (type, role, due rule, deps,
	 * conditions). The panel state itself lives in BuilderInner. */
	onConfigureStep: (stepId: string) => void;
	/** Opens the slide-in panel for per-field config (label, key with lock state,
	 * type, options, required, help). */
	onConfigureField: (fieldId: string) => void;
}) {
	const sections: RunStepListSection[] = bundle.sections;
	// Phase 12.2 -- pre-resolve anchor/source titles + keys so the RunStepList's
	// row chip never has to do its own lookups (and so a passing-by reader can see
	// at a glance "this step is due 2d after Inspect kitchen" without opening the
	// config panel). Anchor lookup misses (anchor was deleted, say) fall through
	// to null + the chip renders "due rule incomplete." Memoized against
	// bundle.steps / bundle.fields so the Maps aren't rebuilt on every typing-
	// driven re-render of the config panel.
	const stepTitleById = useMemo(
		() => new Map(bundle.steps.map((s) => [s.id, s.title] as const)),
		[bundle.steps],
	);
	const fieldKeyById = useMemo(
		() => new Map(bundle.fields.map((f) => [f.id, f.key] as const)),
		[bundle.fields],
	);
	const definitionSteps: RunStepListDefinitionStep[] = useMemo(
		() =>
			bundle.steps.map((s) => ({
				id: s.id,
				sectionId: s.sectionId,
				position: s.position,
				isRequired: s.isRequired,
				type: s.type as StepType,
				dueRule: {
					dueType: s.dueType,
					dueOffsetDays: s.dueOffsetDays,
					dueAnchorStepTitle: s.dueAnchorStepId
						? stepTitleById.get(s.dueAnchorStepId) ?? null
						: null,
					dueSourceFieldKey: s.dueSourceFieldId
						? fieldKeyById.get(s.dueSourceFieldId) ?? null
						: null,
				},
				// D-040 -- thread the row's provenance so the rail can render the
				// AI badge on ai_generated steps. Default (manually_edited) renders
				// no badge, so user-authored steps stay visually clean.
				provenance: s.provenance,
			})),
		[bundle.steps, stepTitleById, fieldKeyById],
	);
	const runStepListItems: RunStepListItem[] = bundle.steps.map((s) => ({
		id: s.id,
		stepId: s.id,
		title: s.title,
		status: "pending" as RunStepStatus,
		blocked: false,
		position: s.position,
	}));

	const activeStep = activeStepId ? bundle.steps.find((s) => s.id === activeStepId) : null;
	const fieldsForPanel: RunStepPanelFieldRow[] = fieldsForStep.map((f) => ({
		id: f.id,
		key: f.key,
		label: f.label,
		fieldType: f.fieldType as FieldType,
		config: f.config,
		isRequired: f.isRequired,
		position: f.position,
		isKeyLocked: f.isKeyLocked,
	}));

	return (
		<div className="flex flex-1 min-h-0">
			{/* Author shell left rail. Phase 9.5 R4 lift splits the rail into a
			    scrollable top region (step list) and a pinned bottom region
			    (Template Variables sidebar) per PRD_WORKFLOW_SOP_BUILDER §6.2.
			    `flex flex-col` lets the top region take the remaining height while
			    the sidebar caps at 40vh so the step list always has room. */}
			<aside className="w-64 shrink-0 border-r border-border bg-muted/30 flex flex-col">
				<div className="flex-1 overflow-y-auto p-2 min-h-0">
					{/* Kickoff entry above sections + steps per UX_SPEC §4.3.
					    Composed at AuthorBody level (not inside RunStepList) so the
					    rail-list primitive stays focused on sections + steps. */}
					<KickoffRailEntry
						active={kickoffActive}
						kickoffFieldCount={kickoffFields.length}
						onSelect={onSelectKickoff}
					/>
					<RunStepList
						sections={sections}
						definitionSteps={definitionSteps}
						runSteps={runStepListItems}
						activeRunStepId={activeStepId}
						onSelectStep={onSelectStep}
						mode="author"
						authorCallbacks={{
							onAddSection: () =>
								createSection.mutate({
									workflowVersionId: bundle.version.id,
									title: "Untitled section",
								}),
							onAddStepInSection: (sectionId) =>
								createStep.mutate({
									workflowVersionId: bundle.version.id,
									sectionId,
									title: "Untitled step",
								}),
							onReorderSteps: (ordering) =>
								reorderSteps.mutate({
									workflowVersionId: bundle.version.id,
									ordering,
								}),
						}}
					/>
				</div>
				{/* Phase 9.5 R4 -- Template Variables sidebar. Click-to-copy in v1;
				    drag-drop into Tiptap editors is a follow-on that wires the
				    sidebar into specific editor instances. */}
				<div className="border-t border-border p-2 max-h-[40vh] flex flex-col min-h-0">
					<TemplateVariablesSidebar className="flex-1 min-h-0" />
				</div>
			</aside>
			<div className="flex-1 min-w-0 overflow-y-auto">
				{kickoffActive ? (
					<KickoffPanel
						kickoffFields={kickoffFields}
						onAddField={() =>
							createField.mutate({
								workflowVersionId: bundle.version.id,
								stepId: null,
								label: "Untitled kickoff field",
								fieldType: "text",
							})
						}
						onUpdateFieldLabel={(fieldId, value) =>
							updateField.mutate({ fieldId, label: value })
						}
						onUpdateFieldRequired={(fieldId, value) =>
							updateField.mutate({ fieldId, isRequired: value })
						}
						onDeleteField={(fieldId) => deleteField.mutate({ fieldId })}
						onConfigureField={(fieldId) => onConfigureField(fieldId)}
					/>
				) : activeStep ? (
					<RunStepPanel
						data={{
							runStepId: activeStep.id,
							stepId: activeStep.id,
							title: activeStep.title,
							description: activeStep.description,
							status: "pending",
							runStatus: "active",
							stepType: activeStep.type as StepType,
							blocked: false,
							canComplete: false,
							dueAt: null,
							assigneeDisplay: null,
							isAssignedToMe: false,
							isRequired: activeStep.isRequired,
						}}
						fields={fieldsForPanel}
						fieldValuesByKey={EMPTY_VALUES}
						fieldSaveState={EMPTY_SAVE_STATES}
						fieldErrors={EMPTY_FIELD_ERRORS}
						mode="author"
						completing={false}
						completeError={null}
						onSetFieldValue={NOOP_SET_FIELD}
						onCompleteStep={NOOP_COMPLETE}
						authorCallbacks={{
							onUpdateStepTitle: (value) =>
								updateStep.mutate({ stepId: activeStep.id, title: value }),
							onUpdateStepDescription: (value) =>
								updateStep.mutate({ stepId: activeStep.id, description: value }),
							onDeleteStep: () => deleteStep.mutate({ stepId: activeStep.id }),
							onAddField: () =>
								createField.mutate({
									workflowVersionId: bundle.version.id,
									stepId: activeStep.id,
									label: "Untitled field",
									fieldType: "text",
								}),
							onUpdateFieldLabel: (fieldId, value) =>
								updateField.mutate({ fieldId, label: value }),
							onUpdateFieldRequired: (fieldId, value) =>
								updateField.mutate({ fieldId, isRequired: value }),
							onDeleteField: (fieldId) => deleteField.mutate({ fieldId }),
							onConfigureStep: () => onConfigureStep(activeStep.id),
							onConfigureField: (fieldId) => onConfigureField(fieldId),
						}}
					/>
				) : (
					<EmptyStepHint />
				)}
			</div>
		</div>
	);
}

function PreviewBody({
	bundle,
	workflowTitle,
	activeRunStepId,
	onSelectStep,
}: {
	bundle: VersionEditBundleResponse;
	workflowTitle: string;
	activeRunStepId: string | null;
	onSelectStep: (id: string) => void;
}) {
	const previewRun = useMemo(() => buildPreviewFromBundle(bundle, workflowTitle), [bundle, workflowTitle]);

	const sections: RunStepListSection[] = bundle.sections;
	const definitionSteps: RunStepListDefinitionStep[] = bundle.steps.map((s) => ({
		id: s.id,
		sectionId: s.sectionId,
		position: s.position,
		isRequired: s.isRequired,
		type: s.type as StepType,
	}));
	const runStepListItems: RunStepListItem[] = previewRun.steps.map((s) => ({
		id: s.id,
		stepId: s.stepId,
		title: s.title,
		status: s.status,
		blocked: s.blocked,
		position: s.position,
	}));
	const initialActiveId = activeRunStepId ?? runStepListItems[0]?.id ?? null;
	const activePreviewStep = previewRun.steps.find((s) => s.id === initialActiveId) ?? null;
	const fieldsForActiveStep = activePreviewStep?.stepId
		? bundle.fields.filter((f) => f.stepId === activePreviewStep.stepId)
		: [];

	return (
		<div className="flex flex-1 min-h-0">
			<aside className="w-64 shrink-0 border-r border-border bg-muted/30 overflow-y-auto">
				<RunStepList
					sections={sections}
					definitionSteps={definitionSteps}
					runSteps={runStepListItems}
					activeRunStepId={initialActiveId}
					onSelectStep={onSelectStep}
					mode="preview"
				/>
			</aside>
			<div className="flex-1 min-w-0 overflow-y-auto">
				{activePreviewStep ? (
					<RunStepPanel
						data={{
							runStepId: activePreviewStep.id,
							stepId: activePreviewStep.stepId,
							title: activePreviewStep.title,
							description: activePreviewStep.description,
							status: activePreviewStep.status as RunStepStatus,
							runStatus: previewRun.status as RunStatus,
							stepType: (bundle.steps.find((s) => s.id === activePreviewStep.stepId)?.type ??
								"task") as StepType,
							blocked: activePreviewStep.blocked,
							canComplete: activePreviewStep.canComplete,
							dueAt: null,
							assigneeDisplay: null,
							isAssignedToMe: false,
						}}
						fields={fieldsForActiveStep.map((f) => ({
							id: f.id,
							key: f.key,
							label: f.label,
							fieldType: f.fieldType as FieldType,
							config: f.config,
							isRequired: f.isRequired,
							position: f.position,
						}))}
						fieldValuesByKey={EMPTY_VALUES}
						fieldSaveState={EMPTY_SAVE_STATES}
						fieldErrors={EMPTY_FIELD_ERRORS}
						mode="preview"
						completing={false}
						completeError={null}
						// Preview is no-side-effect by contract -- these never reach the run engine.
						onSetFieldValue={NOOP_SET_FIELD}
						onCompleteStep={NOOP_COMPLETE}
					/>
				) : (
					<EmptyStepHint />
				)}
			</div>
		</div>
	);
}

function ViewBody({
	bundle,
	activeStepId,
	onSelectStep,
}: {
	bundle: VersionEditBundleResponse;
	activeStepId: string | null;
	onSelectStep: (id: string) => void;
}) {
	const sections: RunStepListSection[] = bundle.sections;
	const definitionSteps: RunStepListDefinitionStep[] = bundle.steps.map((s) => ({
		id: s.id,
		sectionId: s.sectionId,
		position: s.position,
		isRequired: s.isRequired,
		type: s.type as StepType,
	}));
	const runStepListItems: RunStepListItem[] = bundle.steps.map((s) => ({
		id: s.id,
		stepId: s.id,
		title: s.title,
		status: "pending" as RunStepStatus,
		blocked: false,
		position: s.position,
	}));
	const activeStep = activeStepId ? bundle.steps.find((s) => s.id === activeStepId) : null;
	const fieldsForStep = activeStep
		? bundle.fields.filter((f) => f.stepId === activeStep.id)
		: [];

	return (
		<div className="flex flex-1 min-h-0">
			<aside className="w-64 shrink-0 border-r border-border bg-muted/30 overflow-y-auto">
				<RunStepList
					sections={sections}
					definitionSteps={definitionSteps}
					runSteps={runStepListItems}
					activeRunStepId={activeStepId}
					onSelectStep={onSelectStep}
					mode="view"
				/>
			</aside>
			<div className="flex-1 min-w-0 overflow-y-auto">
				{activeStep ? (
					<RunStepPanel
						data={{
							runStepId: activeStep.id,
							stepId: activeStep.id,
							title: activeStep.title,
							description: activeStep.description,
							status: "pending",
							runStatus: "active",
							stepType: activeStep.type as StepType,
							blocked: false,
							canComplete: false,
							dueAt: null,
							assigneeDisplay: null,
							isAssignedToMe: false,
						}}
						fields={fieldsForStep.map((f) => ({
							id: f.id,
							key: f.key,
							label: f.label,
							fieldType: f.fieldType as FieldType,
							config: f.config,
							isRequired: f.isRequired,
							position: f.position,
						}))}
						fieldValuesByKey={EMPTY_VALUES}
						fieldSaveState={EMPTY_SAVE_STATES}
						fieldErrors={EMPTY_FIELD_ERRORS}
						mode="view"
						completing={false}
						completeError={null}
						onSetFieldValue={NOOP_SET_FIELD}
						onCompleteStep={NOOP_COMPLETE}
					/>
				) : (
					<EmptyStepHint />
				)}
			</div>
		</div>
	);
}

function EmptyStepHint() {
	return (
		<div className="px-5 py-8 text-sm text-foreground/60">
			Select a step from the list (or add one) to begin editing.
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

function ErrorState({ message }: { message: string }) {
	return (
		<div className="px-5 py-8 text-sm text-destructive">{message}</div>
	);
}

// Three typed empty maps so RunStepPanel's typed props accept them without coercion.
// Author / preview / view modes don't write field values, save states, or per-field
// errors from this panel -- empty maps everywhere.
const EMPTY_VALUES: ReadonlyMap<string, unknown> = new Map();
const EMPTY_SAVE_STATES: ReadonlyMap<string, _FieldSaveState> = new Map();
const EMPTY_FIELD_ERRORS: ReadonlyMap<string, string | null> = new Map();

// Preview-mode neutralizers come from a separate module so the no-side-effect
// guarantee is testable in isolation. The author / view branches reuse them too:
// neither writes from this panel.
const NOOP_SET_FIELD = PREVIEW_NOOP_SET_FIELD;
const NOOP_COMPLETE = PREVIEW_NOOP_COMPLETE;

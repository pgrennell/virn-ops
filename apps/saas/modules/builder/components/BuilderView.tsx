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

import {
	useCreateField,
	useCreateSection,
	useCreateStep,
	useDeleteField,
	useDeleteStep,
	useDiscardDraft,
	useEditPublished,
	usePublishVersion,
	useReorderSteps,
	useUpdateField,
	useUpdateStep,
} from "../lib/builder-mutations";
import { buildPreviewFromBundle } from "../lib/preview-adapter";
import { PREVIEW_NOOP_COMPLETE, PREVIEW_NOOP_SET_FIELD } from "../lib/preview-callbacks";
import type { VersionEditBundleResponse } from "../lib/types";
import { BuilderTopBar } from "./BuilderTopBar";

interface BuilderViewProps {
	workflowId: string;
	/** True when the caller is admin/owner of the active org. Resolved server-side via
	 * the gating snapshot in the page (UX_SPEC §2 admin-vs-member axis). Non-admin
	 * members see view mode regardless of draft state -- the API's adminOrgProcedure
	 * refuses non-admin writes anyway, but the UI must not show controls that 403. */
	isAdminOrOwner: boolean;
}

export function BuilderView({ workflowId, isAdminOrOwner }: BuilderViewProps) {
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

	return (
		<BuilderInner
			bundle={bundle}
			workflowTitle={workflowQuery.data.workflow.title}
			forkedFromVersionNumber={forkedFromVersionNumber}
			isDraft={isDraft}
			isAdminOrOwner={isAdminOrOwner}
			previewActive={previewActive}
			onTogglePreview={() => setPreviewActive((p) => !p)}
			topLevelError={topLevelError}
			editPending={editPublishedMutation.isPending}
			onEdit={handleEdit}
			publishPending={publishMutation.isPending}
			onPublish={handlePublish}
			discardPending={discardMutation.isPending}
			onDiscard={handleDiscard}
		/>
	);
}

// ---------------------------------------------------------------------------
// Inner -- splits so author-mode hooks only mount when we actually have a draft.
// Otherwise `useUpdateStep` etc. would mount with an empty versionId.
// ---------------------------------------------------------------------------

interface BuilderInnerProps {
	bundle: VersionEditBundleResponse;
	workflowTitle: string;
	forkedFromVersionNumber: number | null;
	isDraft: boolean;
	isAdminOrOwner: boolean;
	previewActive: boolean;
	onTogglePreview: () => void;
	topLevelError: string | null;
	editPending: boolean;
	onEdit: () => void;
	publishPending: boolean;
	onPublish: () => void;
	discardPending: boolean;
	onDiscard: () => void;
}

function BuilderInner({
	bundle,
	workflowTitle,
	forkedFromVersionNumber,
	isDraft,
	isAdminOrOwner,
	previewActive,
	onTogglePreview,
	topLevelError,
	editPending,
	onEdit,
	publishPending,
	onPublish,
	discardPending,
	onDiscard,
}: BuilderInnerProps) {
	// Mutation hooks (mount unconditionally; they no-op if not invoked).
	const mutArgs = { versionId: bundle.version.id };
	const createSection = useCreateSection(mutArgs);
	const createStep = useCreateStep(mutArgs);
	const createField = useCreateField(mutArgs);
	const updateStep = useUpdateStep(mutArgs);
	const updateField = useUpdateField(mutArgs);
	const deleteStep = useDeleteStep(mutArgs);
	const deleteField = useDeleteField(mutArgs);
	const reorderSteps = useReorderSteps(mutArgs);

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
			topLevelError={topLevelError}
		>
			<AuthorBody
				bundle={bundle}
				activeStepId={activeStepId}
				onSelectStep={setActiveStepId}
				fieldsForStep={fieldsForStep}
				createSection={createSection}
				createStep={createStep}
				createField={createField}
				updateStep={updateStep}
				updateField={updateField}
				deleteStep={deleteStep}
				deleteField={deleteField}
				reorderSteps={reorderSteps}
			/>
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
	onSelectStep,
	fieldsForStep,
	createSection,
	createStep,
	createField,
	updateStep,
	updateField,
	deleteStep,
	deleteField,
	reorderSteps,
}: {
	bundle: VersionEditBundleResponse;
	activeStepId: string | null;
	onSelectStep: (stepId: string | null) => void;
	fieldsForStep: VersionEditBundleResponse["fields"];
	createSection: ReturnType<typeof useCreateSection>;
	createStep: ReturnType<typeof useCreateStep>;
	createField: ReturnType<typeof useCreateField>;
	updateStep: ReturnType<typeof useUpdateStep>;
	updateField: ReturnType<typeof useUpdateField>;
	deleteStep: ReturnType<typeof useDeleteStep>;
	deleteField: ReturnType<typeof useDeleteField>;
	reorderSteps: ReturnType<typeof useReorderSteps>;
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
			<aside className="w-64 shrink-0 border-r border-border bg-muted/30 overflow-y-auto">
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

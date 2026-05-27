"use client";

// apps/saas/modules/builder/lib/builder-mutations.ts
//
// TanStack hooks for the Workflow Builder canvas. Mutation strategy is split per the
// user's Pass 2 note:
//
//   OPTIMISTIC  reorder + in-place edits (label, isRequired, title, description).
//               The client knows the new value; ids don't change; rollback on error.
//
//   AWAIT       create section / step / field. The server owns the cuid id AND the
//               collision-resolved field key -- inserting an optimistic row would lie
//               about both, and a follow-up dependency add against a temp id would
//               break. Brief pending state is fine; creates aren't high-frequency.
//
//   AWAIT       delete + publish + editPublished + discardDraft. The server cascade
//               (e.g. delete-step removing fields) is opaque to the client; better to
//               refetch the bundle than to try to predict it.
//
// Invalidation invalidates the version-bundle query so the canvas re-paints from server
// truth after every mutation.

import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import type { VersionEditBundleResponse } from "./types";

// The cached bundle is the full oRPC-inferred shape (which IS VersionEditBundleResponse
// per types.ts -- single source of truth, no drift).
type CachedBundle = VersionEditBundleResponse;

interface VersionBundleQueryArgs {
	versionId: string;
}

function bundleKey(args: VersionBundleQueryArgs) {
	return orpc.workflows.getVersionBundle.queryKey({ input: { versionId: args.versionId } });
}

// ---------------------------------------------------------------------------
// Optimistic helpers (in-place edits + reorder)
// ---------------------------------------------------------------------------

/** Optimistic in-place patch on the version-bundle cache. Returns the snapshot for
 * rollback. */
function patchBundleCache(
	queryClient: ReturnType<typeof useQueryClient>,
	args: VersionBundleQueryArgs,
	patch: (b: CachedBundle) => CachedBundle,
) {
	const key = bundleKey(args);
	const prev = queryClient.getQueryData<CachedBundle>(key);
	if (prev) {
		queryClient.setQueryData(key, patch(prev));
	}
	return prev;
}

function rollback(
	queryClient: ReturnType<typeof useQueryClient>,
	args: VersionBundleQueryArgs,
	prev: CachedBundle | undefined,
) {
	if (prev) {
		queryClient.setQueryData(bundleKey(args), prev);
	}
}

// ---------------------------------------------------------------------------
// In-place edits (OPTIMISTIC)
// ---------------------------------------------------------------------------

export function useUpdateStep(args: VersionBundleQueryArgs) {
	const queryClient = useQueryClient();
	const mutation = useMutation({
		...orpc.workflows.updateStep.mutationOptions(),
		onMutate: async (input) => {
			await queryClient.cancelQueries({ queryKey: bundleKey(args) });
			const prev = patchBundleCache(queryClient, args, (b) => ({
				...b,
				steps: b.steps.map((s) =>
					s.id === input.stepId
						? {
								...s,
								title: input.title ?? s.title,
								description: input.description !== undefined ? input.description : s.description,
								isRequired: input.isRequired ?? s.isRequired,
								type: (input.type ?? s.type) as typeof s.type,
								isStopTask: input.isStopTask ?? s.isStopTask,
							}
						: s,
				),
			}));
			return { prev };
		},
		onError: (_err, _input, context) => {
			rollback(queryClient, args, context?.prev);
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: bundleKey(args) });
		},
	});
	return mutation;
}

/**
 * Field-key rename. AWAIT, not optimistic -- the server may collision-resolve
 * (`name` -> `name_2`) and we wait for the real value rather than briefly painting
 * the wrong key. Same reason creates await. When the server refuses with
 * FIELD_KEY_LOCKED, the error's `data.referencers` array drives the "clear these
 * references first" affordance in the field config form (D-017).
 *
 * Separate from useUpdateField (which is optimistic for label/required/etc. but
 * explicitly skips `key` in its optimistic patch) so the await semantics live in
 * exactly one place and can't drift.
 */
export function useRenameField(args: VersionBundleQueryArgs) {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.workflows.updateField.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: bundleKey(args) });
		},
	});
}

export function useUpdateField(args: VersionBundleQueryArgs) {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.workflows.updateField.mutationOptions(),
		onMutate: async (input) => {
			await queryClient.cancelQueries({ queryKey: bundleKey(args) });
			const prev = patchBundleCache(queryClient, args, (b) => ({
				...b,
				fields: b.fields.map((f) =>
					f.id === input.fieldId
						? {
								...f,
								label: input.label ?? f.label,
								isRequired: input.isRequired ?? f.isRequired,
								// `key` we DON'T optimistically apply -- the server may collision-resolve
								// it (resolveUniqueKey adds _2/_3 suffix). Wait for the real value.
							}
						: f,
				),
			}));
			return { prev };
		},
		onError: (_err, _input, context) => {
			rollback(queryClient, args, context?.prev);
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: bundleKey(args) });
		},
	});
}

export function useUpdateSection(args: VersionBundleQueryArgs) {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.workflows.updateSection.mutationOptions(),
		onMutate: async (input) => {
			await queryClient.cancelQueries({ queryKey: bundleKey(args) });
			const prev = patchBundleCache(queryClient, args, (b) => ({
				...b,
				sections: b.sections.map((s) =>
					s.id === input.sectionId
						? { ...s, title: input.title ?? s.title, position: input.position ?? s.position }
						: s,
				),
			}));
			return { prev };
		},
		onError: (_err, _input, context) => {
			rollback(queryClient, args, context?.prev);
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: bundleKey(args) });
		},
	});
}

// ---------------------------------------------------------------------------
// Reorder (OPTIMISTIC -- ids don't change)
// ---------------------------------------------------------------------------

export function useReorderSteps(args: VersionBundleQueryArgs) {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.workflows.reorderSteps.mutationOptions(),
		onMutate: async (input) => {
			await queryClient.cancelQueries({ queryKey: bundleKey(args) });
			const positionByStepId = new Map(input.ordering.map((o) => [o.stepId, o.position]));
			const prev = patchBundleCache(queryClient, args, (b) => ({
				...b,
				steps: b.steps.map((s) => {
					const newPos = positionByStepId.get(s.id);
					return newPos !== undefined ? { ...s, position: newPos } : s;
				}),
			}));
			return { prev };
		},
		onError: (_err, _input, context) => {
			rollback(queryClient, args, context?.prev);
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: bundleKey(args) });
		},
	});
}

// ---------------------------------------------------------------------------
// Creates (AWAIT -- server owns id + collision-resolved key)
// ---------------------------------------------------------------------------

export function useCreateSection(args: VersionBundleQueryArgs) {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.workflows.createSection.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: bundleKey(args) });
		},
	});
}

export function useCreateStep(args: VersionBundleQueryArgs) {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.workflows.createStep.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: bundleKey(args) });
		},
	});
}

export function useCreateField(args: VersionBundleQueryArgs) {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.workflows.createField.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: bundleKey(args) });
		},
	});
}

// ---------------------------------------------------------------------------
// Step dependencies (AWAIT -- low-frequency; refetch picks up the new edges)
// ---------------------------------------------------------------------------

export function useAddStepDependency(args: VersionBundleQueryArgs) {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.workflows.addStepDependency.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: bundleKey(args) });
		},
	});
}

export function useRemoveStepDependency(args: VersionBundleQueryArgs) {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.workflows.removeStepDependency.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: bundleKey(args) });
		},
	});
}

// ---------------------------------------------------------------------------
// Deletes (AWAIT -- cascades are opaque, refetch is honest)
// ---------------------------------------------------------------------------

export function useDeleteStep(args: VersionBundleQueryArgs) {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.workflows.deleteStep.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: bundleKey(args) });
		},
	});
}

export function useDeleteField(args: VersionBundleQueryArgs) {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.workflows.deleteField.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: bundleKey(args) });
		},
	});
}

// ---------------------------------------------------------------------------
// Versioning (publish + edit + discard)
// ---------------------------------------------------------------------------

export function usePublishVersion() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.workflows.publishVersion.mutationOptions(),
		onSuccess: (_data, vars) => {
			queryClient.invalidateQueries({
				queryKey: orpc.workflows.getVersionBundle.queryKey({ input: { versionId: vars.versionId } }),
			});
		},
	});
}

export function useEditPublished() {
	return useMutation({
		...orpc.workflows.editPublished.mutationOptions(),
	});
}

// Workflow roles (org-level). Surfaces the inline "+ New role" affordance in the
// step assignee picker so a fresh-org user isn't stuck staring at an empty list. AWAIT
// posture -- server owns the cuid id, same reason useCreateField/Step/Section await.
// On success, the workflows.listRoles query invalidates and the picker rebuilds with
// the new entry; the caller selects it.
export function useCreateWorkflowRole() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.workflows.createRole.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.workflows.listRoles.queryKey({ input: {} }),
			});
		},
	});
}

export function useDiscardDraft() {
	return useMutation({
		...orpc.workflows.discardDraft.mutationOptions(),
	});
}

// ---------------------------------------------------------------------------
// Bundle hook
// ---------------------------------------------------------------------------

export function useInvalidateBundle(args: VersionBundleQueryArgs) {
	const queryClient = useQueryClient();
	return useCallback(() => {
		queryClient.invalidateQueries({ queryKey: bundleKey(args) });
	}, [queryClient, args]);
}

"use client";

// ManageListingTagsDialog — toggle which entity sets a given listing belongs
// to. Listing-perspective counterpart to EntitySetMembersDialog (set-
// perspective). Same backing API (entitySets.addMember / removeMember), flipped
// UX axis: "which tags does this listing have?" rather than "which listings
// does this tag have?"
//
// Reads the org's full set catalog via entitySets.list (filtered to
// entity_type='listing'). Reads the listing's current memberships via
// entitySets.listForEntity. Toggles via add/removeMember. Per-toggle save
// matches the Builder Scope panel pattern.

import { Button } from "@virn/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@virn/ui/components/dialog";
import { Spinner } from "@virn/ui/components/spinner";
import { toastError } from "@virn/ui/components/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Tag } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

interface ManageListingTagsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	listingId: string;
	listingName: string;
	organizationSlug: string;
}

export function ManageListingTagsDialog({
	open,
	onOpenChange,
	listingId,
	listingName,
	organizationSlug,
}: ManageListingTagsDialogProps) {
	const queryClient = useQueryClient();

	const setsQuery = useQuery({
		...orpc.entitySets.list.queryOptions({ input: { entityType: "listing" } }),
		enabled: open,
	});
	const myTagsQuery = useQuery({
		...orpc.entitySets.listForEntity.queryOptions({
			input: { entityType: "listing", entityId: listingId },
		}),
		enabled: open,
	});

	const currentIds = useMemo(() => {
		const set = new Set<string>();
		for (const t of myTagsQuery.data ?? []) set.add(t.id);
		return set;
	}, [myTagsQuery.data]);

	const addMutation = useMutation(orpc.entitySets.addMember.mutationOptions());
	const removeMutation = useMutation(orpc.entitySets.removeMember.mutationOptions());
	const anyPending = addMutation.isPending || removeMutation.isPending;

	function invalidate() {
		// Reverse lookup for this listing (the chip strip on the row + this dialog).
		queryClient.invalidateQueries({
			queryKey: orpc.entitySets.listForEntity.queryKey({
				input: { entityType: "listing", entityId: listingId },
			}),
		});
		// Set list -- memberCount on the set rows.
		queryClient.invalidateQueries({
			queryKey: orpc.entitySets.list.queryKey(),
		});
		// Batched chip query + set-perspective members dialog. Use `.key()` (the
		// "partial matching key for revalidation" oRPC helper) since both procedures
		// have required input and `.queryKey()` would force us to commit to a
		// specific input variant.
		queryClient.invalidateQueries({
			queryKey: orpc.entitySets.listForEntities.key(),
		});
		queryClient.invalidateQueries({
			queryKey: orpc.entitySets.listMembers.key(),
		});
	}

	function toggle(setId: string, currentlyMember: boolean) {
		if (anyPending) return;
		const args = {
			entitySetId: setId,
			entityType: "listing" as const,
			entityId: listingId,
		};
		if (currentlyMember) {
			removeMutation.mutate(args, {
				onSuccess: invalidate,
				onError: (err) => toastError(err.message ?? "Couldn't remove tag."),
			});
		} else {
			addMutation.mutate(args, {
				onSuccess: invalidate,
				onError: (err) => toastError(err.message ?? "Couldn't add tag."),
			});
		}
	}

	const sets = setsQuery.data ?? [];

	return (
		<Dialog open={open} onOpenChange={(v) => !anyPending && onOpenChange(v)}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Sets for "{listingName}"</DialogTitle>
					<DialogDescription>
						Tag this listing with the entity sets it belongs to. Workflows scoped to
						any of these sets will surface in the launcher for this listing.
					</DialogDescription>
				</DialogHeader>

				<div className="mt-2 max-h-[60vh] overflow-y-auto">
					{setsQuery.isLoading || myTagsQuery.isLoading ? (
						<div className="py-12 text-foreground/50 gap-2 flex items-center justify-center">
							<Spinner className="size-4" />
							<span className="text-sm">Loading…</span>
						</div>
					) : setsQuery.isError ? (
						<div className="py-6 text-sm text-destructive">
							Couldn't load entity sets.
						</div>
					) : sets.length === 0 ? (
						<div className="py-10 px-4 rounded-md border border-dashed border-border gap-2 flex flex-col items-center text-center">
							<Tag className="size-6 text-foreground/40" />
							<p className="text-sm font-medium">No entity sets yet</p>
							<p className="text-xs text-foreground/60 max-w-sm">
								Create some sets first, then tag this listing with them.
							</p>
							<Link
								href={`/${organizationSlug}/library/entity-sets`}
								className="text-xs text-primary hover:underline mt-1"
							>
								<Plus className="size-3 inline mr-1" />
								Manage entity sets
							</Link>
						</div>
					) : (
						<ul className="divide-y divide-border border border-border rounded-md overflow-hidden">
							{sets.map((s) => {
								const isMember = currentIds.has(s.id);
								return (
									<li
										key={s.id}
										className="px-3 py-2 gap-3 flex items-center bg-background"
									>
										<div
											className="size-7 shrink-0 rounded gap-0 flex items-center justify-center"
											style={{
												backgroundColor: s.color ?? undefined,
												...(s.color ? {} : { backgroundColor: "var(--muted)" }),
											}}
										>
											<Tag className="size-3.5 text-foreground/70" />
										</div>
										<div className="flex-1 min-w-0">
											<p className="text-sm font-medium truncate">{s.name}</p>
											<p className="text-[11px] text-foreground/50">
												{s.memberCount}{" "}
												{s.memberCount === 1 ? "member" : "members"}
											</p>
										</div>
										<Button
											type="button"
											size="sm"
											variant={isMember ? "secondary" : "ghost"}
											onClick={() => toggle(s.id, isMember)}
											disabled={anyPending}
											className="shrink-0 text-xs"
										>
											{isMember ? (
												<>
													<Check className="size-3.5 mr-1" />
													Tagged
												</>
											) : (
												<>
													<Plus className="size-3.5 mr-1" />
													Tag
												</>
											)}
										</Button>
									</li>
								);
							})}
						</ul>
					)}
				</div>

				<DialogFooter className="mt-2">
					<Button
						variant="ghost"
						onClick={() => onOpenChange(false)}
						disabled={anyPending}
					>
						Done
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

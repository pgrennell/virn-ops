"use client";

// EntitySetMembersDialog — toggle which listings belong to this set (set-
// perspective). Symmetric counterpart to ManageListingTagsDialog
// (listing-perspective): same backing API (entitySets.addMember / removeMember),
// flipped UX axis.
//
// The membership list comes from entitySets.listMembers (member entityIds).
// The full listings catalog comes from listings.list. We display every listing
// as a chip-style row with a check-mark indicating whether it's in this set.
// Per-toggle save matches the Builder Scope panel's instant-save model.

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
import { Check, Home, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

interface EntitySetMembersDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	entitySetId: string;
	entitySetName: string;
	organizationSlug: string;
}

export function EntitySetMembersDialog({
	open,
	onOpenChange,
	entitySetId,
	entitySetName,
	organizationSlug,
}: EntitySetMembersDialogProps) {
	const queryClient = useQueryClient();

	const listingsQuery = useQuery({
		...orpc.listings.list.queryOptions({ input: {} }),
		enabled: open,
	});
	const membersQuery = useQuery({
		...orpc.entitySets.listMembers.queryOptions({ input: { entitySetId } }),
		enabled: open,
	});

	const memberIds = useMemo(() => {
		const set = new Set<string>();
		for (const m of membersQuery.data ?? []) set.add(m.entityId);
		return set;
	}, [membersQuery.data]);

	const addMutation = useMutation(orpc.entitySets.addMember.mutationOptions());
	const removeMutation = useMutation(orpc.entitySets.removeMember.mutationOptions());
	const anyPending = addMutation.isPending || removeMutation.isPending;

	function invalidateMembers() {
		queryClient.invalidateQueries({
			queryKey: orpc.entitySets.listMembers.queryKey({ input: { entitySetId } }),
		});
		// memberCount on the set list -- invalidate so the index reflects the new count.
		queryClient.invalidateQueries({
			queryKey: orpc.entitySets.list.queryKey(),
		});
	}

	function toggle(listingId: string, currentlyMember: boolean) {
		if (anyPending) return;
		const args = {
			entitySetId,
			entityType: "listing" as const,
			entityId: listingId,
		};
		if (currentlyMember) {
			removeMutation.mutate(args, {
				onSuccess: invalidateMembers,
				onError: (err) => toastError(err.message ?? "Couldn't remove member."),
			});
		} else {
			addMutation.mutate(args, {
				onSuccess: invalidateMembers,
				onError: (err) => toastError(err.message ?? "Couldn't add member."),
			});
		}
	}

	const listings = listingsQuery.data ?? [];

	return (
		<Dialog open={open} onOpenChange={(v) => !anyPending && onOpenChange(v)}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Members of "{entitySetName}"</DialogTitle>
					<DialogDescription>
						Toggle listings in or out of this set. Changes save instantly.
					</DialogDescription>
				</DialogHeader>

				<div className="mt-2 max-h-[60vh] overflow-y-auto">
					{listingsQuery.isLoading || membersQuery.isLoading ? (
						<div className="py-12 text-foreground/50 gap-2 flex items-center justify-center">
							<Spinner className="size-4" />
							<span className="text-sm">Loading…</span>
						</div>
					) : listingsQuery.isError ? (
						<div className="py-6 text-sm text-destructive">
							Couldn't load listings.
						</div>
					) : listings.length === 0 ? (
						<div className="py-10 px-4 rounded-md border border-dashed border-border gap-2 flex flex-col items-center text-center">
							<Home className="size-6 text-foreground/40" />
							<p className="text-sm font-medium">No listings yet</p>
							<p className="text-xs text-foreground/60 max-w-sm">
								Add some listings first, then come back to assign them to this set.
							</p>
							<Link
								href={`/${organizationSlug}/library/listings`}
								className="text-xs text-primary hover:underline mt-1"
							>
								<Plus className="size-3 inline mr-1" />
								Go to listings
							</Link>
						</div>
					) : (
						<ul className="divide-y divide-border border border-border rounded-md overflow-hidden">
							{listings.map((l) => {
								const isMember = memberIds.has(l.id);
								return (
									<li
										key={l.id}
										className="px-3 py-2 gap-3 flex items-center bg-background"
									>
										<div className="size-7 shrink-0 rounded bg-muted gap-0 flex items-center justify-center">
											<Home className="size-3.5 text-foreground/70" />
										</div>
										<div className="flex-1 min-w-0">
											<p className="text-sm font-medium truncate">{l.name}</p>
											{l.propertyType && (
												<p className="text-[11px] text-foreground/50 uppercase tracking-wide">
													{l.propertyType}
												</p>
											)}
										</div>
										<Button
											type="button"
											size="sm"
											variant={isMember ? "secondary" : "ghost"}
											onClick={() => toggle(l.id, isMember)}
											disabled={anyPending}
											className="shrink-0 text-xs"
										>
											{isMember ? (
												<>
													<Check className="size-3.5 mr-1" />
													In set
												</>
											) : (
												<>
													<Plus className="size-3.5 mr-1" />
													Add
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

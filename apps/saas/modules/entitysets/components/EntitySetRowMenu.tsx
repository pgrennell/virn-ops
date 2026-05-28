"use client";

// EntitySetRowMenu — manage members / edit / delete actions per entity-set row.
// Members management opens a dialog that toggles which listings belong to this
// set (set-perspective membership; the listing-perspective is in the listings
// page's Manage-tags dialog).

import { Button } from "@virn/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@virn/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@virn/ui/components/dropdown-menu";
import { Spinner } from "@virn/ui/components/spinner";
import { toastError, toastSuccess } from "@virn/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Edit3, MoreVertical, Trash2, Users } from "lucide-react";
import { useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

import { EditEntitySetDialog } from "./EditEntitySetDialog";
import { EntitySetMembersDialog } from "./EntitySetMembersDialog";

interface EntitySetRowMenuProps {
	entitySetId: string;
	entitySetName: string;
	color: string | null;
	description: string | null;
	organizationSlug: string;
}

export function EntitySetRowMenu({
	entitySetId,
	entitySetName,
	color,
	description,
	organizationSlug,
}: EntitySetRowMenuProps) {
	const queryClient = useQueryClient();
	const [editOpen, setEditOpen] = useState(false);
	const [membersOpen, setMembersOpen] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);

	const deleteMutation = useMutation(orpc.entitySets.delete.mutationOptions());

	const handleDelete = () => {
		deleteMutation.mutate(
			{ id: entitySetId },
			{
				onSuccess: () => {
					queryClient.invalidateQueries({
						queryKey: orpc.entitySets.list.queryKey(),
					});
					setConfirmDelete(false);
					toastSuccess("Entity set deleted.");
				},
				onError: (err) =>
					toastError(err.message ?? "Couldn't delete the entity set."),
			},
		);
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						aria-label={`Actions for ${entitySetName}`}
						className="size-8 p-0"
					>
						<MoreVertical className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-48">
					<DropdownMenuItem onClick={() => setMembersOpen(true)}>
						<Users className="size-3.5 mr-2" />
						Manage members
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => setEditOpen(true)}>
						<Edit3 className="size-3.5 mr-2" />
						Edit set
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={() => setConfirmDelete(true)}
						className="text-destructive focus:text-destructive"
					>
						<Trash2 className="size-3.5 mr-2" />
						Delete set
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<EditEntitySetDialog
				open={editOpen}
				onOpenChange={setEditOpen}
				entitySetId={entitySetId}
				initialName={entitySetName}
				initialColor={color}
				initialDescription={description}
			/>

			<EntitySetMembersDialog
				open={membersOpen}
				onOpenChange={setMembersOpen}
				entitySetId={entitySetId}
				entitySetName={entitySetName}
				organizationSlug={organizationSlug}
			/>

			<Dialog
				open={confirmDelete}
				onOpenChange={(v) => !deleteMutation.isPending && setConfirmDelete(v)}
			>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>Delete "{entitySetName}"?</DialogTitle>
						<DialogDescription>
							This deletes the set and removes the membership of every entity it
							currently holds. Any workflow that scoped itself to this set will keep
							the dangling id in its scope array — it'll just stop matching anything.
							This can't be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter className="mt-4">
						<Button
							variant="ghost"
							onClick={() => setConfirmDelete(false)}
							disabled={deleteMutation.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleDelete}
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending && <Spinner className="size-3.5 mr-1.5" />}
							Delete set
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

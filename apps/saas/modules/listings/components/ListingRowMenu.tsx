"use client";

// ListingRowMenu — edit / archive actions per listing row. Mirrors VendorRowMenu.

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
import { Edit3, MoreVertical, Trash2 } from "lucide-react";
import { useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

import { EditListingDialog } from "./EditListingDialog";

interface ListingRowMenuProps {
	listingId: string;
	listingName: string;
	description: string | null;
	propertyType: string | null;
	externalListingId: string | null;
}

export function ListingRowMenu({
	listingId,
	listingName,
	description,
	propertyType,
	externalListingId,
}: ListingRowMenuProps) {
	const queryClient = useQueryClient();
	const [editOpen, setEditOpen] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);

	const deleteMutation = useMutation(orpc.listings.softDelete.mutationOptions());

	const handleDelete = () => {
		deleteMutation.mutate(
			{ id: listingId },
			{
				onSuccess: () => {
					queryClient.invalidateQueries({
						queryKey: orpc.listings.list.queryKey(),
					});
					setConfirmDelete(false);
					toastSuccess("Listing archived.");
				},
				onError: (err) =>
					toastError(err.message ?? "Couldn't archive the listing."),
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
						aria-label={`Actions for ${listingName}`}
						className="size-8 p-0"
					>
						<MoreVertical className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-40">
					<DropdownMenuItem onClick={() => setEditOpen(true)}>
						<Edit3 className="size-3.5 mr-2" />
						Edit listing
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={() => setConfirmDelete(true)}
						className="text-destructive focus:text-destructive"
					>
						<Trash2 className="size-3.5 mr-2" />
						Archive
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<EditListingDialog
				open={editOpen}
				onOpenChange={setEditOpen}
				listingId={listingId}
				initialName={listingName}
				initialDescription={description}
				initialPropertyType={propertyType}
				initialExternalListingId={externalListingId}
			/>

			<Dialog
				open={confirmDelete}
				onOpenChange={(v) => !deleteMutation.isPending && setConfirmDelete(v)}
			>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>Archive "{listingName}"?</DialogTitle>
						<DialogDescription>
							The listing will be soft-archived — it won't appear in the launcher's
							picker anymore, but past run + activity-feed references stay intact.
							This can't be undone from the UI.
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
							Archive listing
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

"use client";

// Per-row action menu for a vendor: manage contacts / edit / archive. Mirrors the
// agent row-menu pattern. No credential-rotation analog (vendors don't have
// long-lived programmatic credentials -- they auth via per-run tokenized links).

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

import { EditVendorDialog } from "./EditVendorDialog";
import { ManageContactsDialog } from "./ManageContactsDialog";

interface VendorRowMenuProps {
	vendorId: string;
	vendorName: string;
	isActive: boolean;
	status: string;
	description: string | null;
}

export function VendorRowMenu({
	vendorId,
	vendorName,
	isActive,
	status,
	description,
}: VendorRowMenuProps) {
	const queryClient = useQueryClient();
	const [editOpen, setEditOpen] = useState(false);
	const [contactsOpen, setContactsOpen] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);

	const deleteMutation = useMutation(orpc.vendors.softDelete.mutationOptions());

	const invalidateList = () =>
		queryClient.invalidateQueries({ queryKey: orpc.vendors.list.queryKey() });

	const handleDelete = () => {
		deleteMutation.mutate(
			{ id: vendorId },
			{
				onSuccess: () => {
					invalidateList();
					setConfirmDelete(false);
					toastSuccess("Vendor archived.");
				},
				onError: (err) => toastError(err.message ?? "Couldn't archive the vendor."),
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
						aria-label={`Actions for ${vendorName}`}
						className="size-8 p-0"
					>
						<MoreVertical className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-44">
					<DropdownMenuItem onClick={() => setContactsOpen(true)}>
						<Users className="size-3.5 mr-2" />
						Manage contacts
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => setEditOpen(true)}>
						<Edit3 className="size-3.5 mr-2" />
						Edit vendor
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

			<EditVendorDialog
				open={editOpen}
				onOpenChange={setEditOpen}
				vendorId={vendorId}
				initialName={vendorName}
				initialDescription={description}
				initialStatus={status}
				initialIsActive={isActive}
			/>

			<ManageContactsDialog
				open={contactsOpen}
				onOpenChange={setContactsOpen}
				vendorId={vendorId}
				vendorName={vendorName}
			/>

			<Dialog
				open={confirmDelete}
				onOpenChange={(v) => !deleteMutation.isPending && setConfirmDelete(v)}
			>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>Archive "{vendorName}"?</DialogTitle>
						<DialogDescription>
							The vendor will be soft-archived — it won't appear in the launcher's picker
							anymore, but past run activity stays in the audit log. This can't be undone
							from the UI.
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
							Archive vendor
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

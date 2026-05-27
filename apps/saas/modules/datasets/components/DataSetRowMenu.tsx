"use client";

// Per-row action menu for a data set: manage records / edit details / archive.
// Mirrors the vendor / agent row-menu pattern.

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
import { Archive, Edit3, MoreVertical, Rows3 } from "lucide-react";
import { useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

import { EditDataSetDialog } from "./EditDataSetDialog";
import { ManageRecordsDialog } from "./ManageRecordsDialog";

interface DataSetRowMenuProps {
	dataSetId: string;
	dataSetName: string;
	dataSetKey: string;
	description: string | null;
}

export function DataSetRowMenu({
	dataSetId,
	dataSetName,
	dataSetKey,
	description,
}: DataSetRowMenuProps) {
	const queryClient = useQueryClient();
	const [recordsOpen, setRecordsOpen] = useState(false);
	const [editOpen, setEditOpen] = useState(false);
	const [confirmArchive, setConfirmArchive] = useState(false);

	const archiveMutation = useMutation(orpc.dataSets.archive.mutationOptions());

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.dataSets.list.queryKey() });

	const handleArchive = () => {
		archiveMutation.mutate(
			{ id: dataSetId },
			{
				onSuccess: () => {
					invalidate();
					setConfirmArchive(false);
					toastSuccess("Data set archived.");
				},
				onError: (err) => toastError(err.message ?? "Couldn't archive the data set."),
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
						aria-label={`Actions for ${dataSetName}`}
						className="size-8 p-0"
					>
						<MoreVertical className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-44">
					<DropdownMenuItem onClick={() => setRecordsOpen(true)}>
						<Rows3 className="size-3.5 mr-2" />
						Manage records
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => setEditOpen(true)}>
						<Edit3 className="size-3.5 mr-2" />
						Edit details
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={() => setConfirmArchive(true)}
						className="text-destructive focus:text-destructive"
					>
						<Archive className="size-3.5 mr-2" />
						Archive
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<ManageRecordsDialog
				open={recordsOpen}
				onOpenChange={setRecordsOpen}
				dataSetId={dataSetId}
				dataSetName={dataSetName}
			/>

			<EditDataSetDialog
				open={editOpen}
				onOpenChange={setEditOpen}
				dataSetId={dataSetId}
				initialName={dataSetName}
				initialKey={dataSetKey}
				initialDescription={description}
			/>

			<Dialog
				open={confirmArchive}
				onOpenChange={(v) => !archiveMutation.isPending && setConfirmArchive(v)}
			>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>Archive "{dataSetName}"?</DialogTitle>
						<DialogDescription>
							The data set won't appear in lookup-field pickers after archiving.
							Existing run field values that reference its records remain readable.
							This can't be undone from the UI.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter className="mt-4">
						<Button
							variant="ghost"
							onClick={() => setConfirmArchive(false)}
							disabled={archiveMutation.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleArchive}
							disabled={archiveMutation.isPending}
						>
							{archiveMutation.isPending && <Spinner className="size-3.5 mr-1.5" />}
							Archive
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

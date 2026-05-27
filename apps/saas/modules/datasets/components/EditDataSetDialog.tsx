"use client";

// EditDataSetDialog -- patches name, key, description of an existing data set.
// Renaming the key will break lookup field configs that reference the old key --
// flagged in the dialog so the admin opts in consciously.

import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Button } from "@virn/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@virn/ui/components/dialog";
import { Input } from "@virn/ui/components/input";
import { Spinner } from "@virn/ui/components/spinner";
import { toastError, toastSuccess } from "@virn/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

interface EditDataSetDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	dataSetId: string;
	initialName: string;
	initialKey: string;
	initialDescription: string | null;
}

export function EditDataSetDialog({
	open,
	onOpenChange,
	dataSetId,
	initialName,
	initialKey,
	initialDescription,
}: EditDataSetDialogProps) {
	const queryClient = useQueryClient();
	const [name, setName] = useState(initialName);
	const [key, setKey] = useState(initialKey);
	const [description, setDescription] = useState(initialDescription ?? "");

	useEffect(() => {
		if (open) {
			setName(initialName);
			setKey(initialKey);
			setDescription(initialDescription ?? "");
		}
	}, [open, initialName, initialKey, initialDescription]);

	const updateMutation = useMutation(orpc.dataSets.update.mutationOptions());

	const keyChanged = key !== initialKey;

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const trimmedName = name.trim();
		const trimmedKey = key.trim();
		if (trimmedName.length === 0 || trimmedKey.length === 0) return;

		updateMutation.mutate(
			{
				id: dataSetId,
				name: trimmedName,
				key: trimmedKey,
				description: description.trim() || null,
			},
			{
				onSuccess: () => {
					queryClient.invalidateQueries({ queryKey: orpc.dataSets.list.queryKey() });
					toastSuccess("Data set updated.");
					onOpenChange(false);
				},
				onError: (err) => toastError(err.message ?? "Couldn't update the data set."),
			},
		);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (updateMutation.isPending) return;
				if (!next) updateMutation.reset();
				onOpenChange(next);
			}}
		>
			<DialogContent className="max-w-md">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>Edit data set</DialogTitle>
						<DialogDescription>
							Change the display name, key, or description. Records are managed
							separately via the "Manage records" menu item.
						</DialogDescription>
					</DialogHeader>

					<div className="mt-4 gap-4 flex flex-col">
						<div>
							<label className="text-sm font-medium mb-1.5 block" htmlFor="edit-ds-name">
								Name
							</label>
							<Input
								id="edit-ds-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								maxLength={120}
								required
								autoFocus
								disabled={updateMutation.isPending}
							/>
						</div>

						<div>
							<label className="text-sm font-medium mb-1.5 block" htmlFor="edit-ds-key">
								Key
							</label>
							<Input
								id="edit-ds-key"
								value={key}
								onChange={(e) => setKey(e.target.value)}
								maxLength={80}
								required
								className="font-mono"
								disabled={updateMutation.isPending}
							/>
							{keyChanged && (
								<Alert variant="error" className="mt-2">
									<AlertDescription className="text-[11px]">
										Renaming the key will break any lookup field config that
										references the old key. Update those configs before publishing
										new workflow versions.
									</AlertDescription>
								</Alert>
							)}
						</div>

						<div>
							<label
								className="text-sm font-medium mb-1.5 block"
								htmlFor="edit-ds-description"
							>
								Description{" "}
								<span className="text-foreground/50 font-normal">(optional)</span>
							</label>
							<Input
								id="edit-ds-description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								maxLength={2000}
								disabled={updateMutation.isPending}
							/>
						</div>
					</div>

					<DialogFooter className="mt-6">
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							disabled={updateMutation.isPending}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="primary"
							disabled={
								name.trim().length === 0 ||
								key.trim().length === 0 ||
								updateMutation.isPending
							}
						>
							{updateMutation.isPending && <Spinner className="size-3.5 mr-1.5" />}
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

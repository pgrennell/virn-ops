"use client";

// CreateDataSetDialog -- name + key + optional description. Auto-slugs the key from
// the name on first keystroke; user can override (the key is immutable after first
// reference -- Phase 9b will surface this; for v1 the field is always editable here).

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
import { toastError } from "@virn/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

interface CreateDataSetDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

function autoSlug(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

export function CreateDataSetDialog({ open, onOpenChange }: CreateDataSetDialogProps) {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [key, setKey] = useState("");
	const [keyEdited, setKeyEdited] = useState(false);
	const [description, setDescription] = useState("");

	const createMutation = useMutation(orpc.dataSets.create.mutationOptions());

	const handleNameChange = (newName: string) => {
		setName(newName);
		if (!keyEdited) setKey(autoSlug(newName));
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const trimmedName = name.trim();
		const trimmedKey = key.trim();
		if (trimmedName.length === 0 || trimmedKey.length === 0) return;

		createMutation.mutate(
			{
				key: trimmedKey,
				name: trimmedName,
				description: description.trim() || null,
			},
			{
				onSuccess: () => {
					queryClient.invalidateQueries({ queryKey: orpc.dataSets.list.queryKey() });
					onOpenChange(false);
					setName("");
					setKey("");
					setKeyEdited(false);
					setDescription("");
				},
				onError: (err) => toastError(err.message ?? "Couldn't create the data set."),
			},
		);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (createMutation.isPending) return;
				if (!next) {
					setName("");
					setKey("");
					setKeyEdited(false);
					setDescription("");
					createMutation.reset();
				}
				onOpenChange(next);
			}}
		>
			<DialogContent className="max-w-md">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>New data set</DialogTitle>
						<DialogDescription>
							A reusable list of values that workflow lookup fields can reference.
							Pick a memorable name and stable key.
						</DialogDescription>
					</DialogHeader>

					<div className="mt-4 gap-4 flex flex-col">
						<div>
							<label className="text-sm font-medium mb-1.5 block" htmlFor="ds-name">
								Name
							</label>
							<Input
								id="ds-name"
								value={name}
								onChange={(e) => handleNameChange(e.target.value)}
								placeholder="e.g. Room types"
								maxLength={120}
								required
								autoFocus
								disabled={createMutation.isPending}
							/>
						</div>

						<div>
							<label className="text-sm font-medium mb-1.5 block" htmlFor="ds-key">
								Key
							</label>
							<Input
								id="ds-key"
								value={key}
								onChange={(e) => {
									setKey(e.target.value);
									setKeyEdited(true);
								}}
								placeholder="e.g. room-types"
								maxLength={80}
								required
								disabled={createMutation.isPending}
								className="font-mono"
							/>
							<p className="mt-1 text-[11px] text-foreground/50">
								Stable identifier. Lookup fields reference this. Lowercase, dashes,
								digits only.
							</p>
						</div>

						<div>
							<label className="text-sm font-medium mb-1.5 block" htmlFor="ds-description">
								Description{" "}
								<span className="text-foreground/50 font-normal">(optional)</span>
							</label>
							<Input
								id="ds-description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								maxLength={2000}
								disabled={createMutation.isPending}
							/>
						</div>
					</div>

					<DialogFooter className="mt-6">
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							disabled={createMutation.isPending}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="primary"
							disabled={
								name.trim().length === 0 ||
								key.trim().length === 0 ||
								createMutation.isPending
							}
						>
							{createMutation.isPending && <Spinner className="size-3.5 mr-1.5" />}
							Create data set
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

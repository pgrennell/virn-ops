"use client";

// EditEntitySetDialog -- patch name / color / description. entityType is NOT
// editable (changing it orphans existing members per the server's update
// validator).

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
import { Textarea } from "@virn/ui/components/textarea";
import { toastError } from "@virn/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

const COLOR_SWATCHES: ReadonlyArray<{ value: string; label: string }> = [
	{ value: "#94a3b8", label: "Slate" },
	{ value: "#f97316", label: "Orange" },
	{ value: "#eab308", label: "Yellow" },
	{ value: "#10b981", label: "Emerald" },
	{ value: "#06b6d4", label: "Cyan" },
	{ value: "#6366f1", label: "Indigo" },
	{ value: "#ec4899", label: "Pink" },
];

interface EditEntitySetDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	entitySetId: string;
	initialName: string;
	initialColor: string | null;
	initialDescription: string | null;
}

export function EditEntitySetDialog({
	open,
	onOpenChange,
	entitySetId,
	initialName,
	initialColor,
	initialDescription,
}: EditEntitySetDialogProps) {
	const queryClient = useQueryClient();
	const [name, setName] = useState(initialName);
	const [description, setDescription] = useState(initialDescription ?? "");
	const [color, setColor] = useState(initialColor ?? "");

	// Reset to fresh server state whenever the dialog opens for a (possibly
	// different) set or after the parent props change.
	useEffect(() => {
		if (open) {
			setName(initialName);
			setDescription(initialDescription ?? "");
			setColor(initialColor ?? "");
		}
	}, [open, initialName, initialDescription, initialColor]);

	const updateMutation = useMutation(orpc.entitySets.update.mutationOptions());

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const trimmedName = name.trim();
		if (trimmedName.length === 0) return;

		updateMutation.mutate(
			{
				id: entitySetId,
				name: trimmedName,
				description: description.trim() || null,
				color: color.trim() || null,
			},
			{
				onSuccess: () => {
					queryClient.invalidateQueries({
						queryKey: orpc.entitySets.list.queryKey(),
					});
					onOpenChange(false);
				},
				onError: (err) => {
					toastError(err.message ?? "Couldn't update the entity set.");
				},
			},
		);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (updateMutation.isPending) return;
				onOpenChange(next);
			}}
		>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Edit entity set</DialogTitle>
					<DialogDescription>
						The set's type can't be changed (it would orphan existing members).
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="gap-4 flex flex-col mt-2">
					<label className="gap-1 flex flex-col">
						<span className="text-xs font-medium text-foreground/80">Name</span>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							maxLength={120}
							autoFocus
							disabled={updateMutation.isPending}
						/>
					</label>

					<label className="gap-1 flex flex-col">
						<span className="text-xs font-medium text-foreground/80">
							Description{" "}
							<span className="text-foreground/40 font-normal">(optional)</span>
						</span>
						<Textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={2}
							maxLength={2000}
							disabled={updateMutation.isPending}
						/>
					</label>

					<div className="gap-1.5 flex flex-col">
						<span className="text-xs font-medium text-foreground/80">
							Color{" "}
							<span className="text-foreground/40 font-normal">(optional)</span>
						</span>
						<div className="gap-1.5 flex flex-wrap items-center">
							{COLOR_SWATCHES.map((sw) => (
								<button
									key={sw.value}
									type="button"
									onClick={() => setColor(color === sw.value ? "" : sw.value)}
									className={`size-6 rounded-full border-2 transition-transform ${
										color === sw.value
											? "border-foreground scale-110"
											: "border-transparent hover:scale-105"
									}`}
									style={{ backgroundColor: sw.value }}
									aria-label={sw.label}
									title={sw.label}
									disabled={updateMutation.isPending}
								/>
							))}
							<Input
								value={color}
								onChange={(e) => setColor(e.target.value)}
								placeholder="#hex"
								maxLength={40}
								className="ml-2 h-7 w-24 text-xs"
								disabled={updateMutation.isPending}
							/>
						</div>
					</div>

					<DialogFooter className="mt-2">
						<Button
							variant="ghost"
							type="button"
							onClick={() => onOpenChange(false)}
							disabled={updateMutation.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="primary"
							type="submit"
							disabled={updateMutation.isPending || name.trim().length === 0}
						>
							{updateMutation.isPending && <Spinner className="size-3.5 mr-1.5" />}
							Save changes
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

"use client";

// CreateEntitySetDialog -- name + optional description + color. entityType is
// fixed to 'listing' in v1.5 (only registered EntityAdapter). When more types
// land, surface a type picker here.

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
import { useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

// Curated palette -- consistent across the app means chips render predictably
// in the Builder Scope panel + listings chip badges. Authors who want a custom
// hex can paste one into the field (free text), but the swatches are the
// fast path.
const COLOR_SWATCHES: ReadonlyArray<{ value: string; label: string }> = [
	{ value: "#94a3b8", label: "Slate" },
	{ value: "#f97316", label: "Orange" },
	{ value: "#eab308", label: "Yellow" },
	{ value: "#10b981", label: "Emerald" },
	{ value: "#06b6d4", label: "Cyan" },
	{ value: "#6366f1", label: "Indigo" },
	{ value: "#ec4899", label: "Pink" },
];

interface CreateEntitySetDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function CreateEntitySetDialog({
	open,
	onOpenChange,
}: CreateEntitySetDialogProps) {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [color, setColor] = useState<string>("");

	const createMutation = useMutation(orpc.entitySets.create.mutationOptions());

	const reset = () => {
		setName("");
		setDescription("");
		setColor("");
		createMutation.reset();
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const trimmedName = name.trim();
		if (trimmedName.length === 0) return;

		createMutation.mutate(
			{
				entityType: "listing",
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
					reset();
				},
				onError: (err) => {
					toastError(err.message ?? "Couldn't create the entity set.");
				},
			},
		);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (createMutation.isPending) return;
				if (!next) reset();
				onOpenChange(next);
			}}
		>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>New entity set</DialogTitle>
					<DialogDescription>
						Group listings into a cohort. Workflows can scope themselves to this set.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="gap-4 flex flex-col mt-2">
					<label className="gap-1 flex flex-col">
						<span className="text-xs font-medium text-foreground/80">Name</span>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder='e.g. "STR penthouses"'
							maxLength={120}
							autoFocus
							disabled={createMutation.isPending}
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
							placeholder="Short note for the team about what this set is for."
							rows={2}
							maxLength={2000}
							disabled={createMutation.isPending}
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
									disabled={createMutation.isPending}
								/>
							))}
							<Input
								value={color}
								onChange={(e) => setColor(e.target.value)}
								placeholder="#hex"
								maxLength={40}
								className="ml-2 h-7 w-24 text-xs"
								disabled={createMutation.isPending}
							/>
						</div>
					</div>

					<DialogFooter className="mt-2">
						<Button
							variant="ghost"
							type="button"
							onClick={() => onOpenChange(false)}
							disabled={createMutation.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="primary"
							type="submit"
							disabled={createMutation.isPending || name.trim().length === 0}
						>
							{createMutation.isPending && <Spinner className="size-3.5 mr-1.5" />}
							Create set
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

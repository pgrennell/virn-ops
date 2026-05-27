"use client";

// CreateListingDialog — name + optional description + property type + optional
// external id. On submit, calls listings.create. v1.5a Day 1-2 minimum form;
// structured address editor and entity-set assignment land in days 3-5.

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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@virn/ui/components/select";
import { Spinner } from "@virn/ui/components/spinner";
import { toastError } from "@virn/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

// Free text in v1.5 (PRD §6.1 — cohort membership via entity_set is canonical).
// The picker offers common values as a convenience but accepts anything.
const PROPERTY_TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
	{ value: "__none__", label: "— Not specified —" },
	{ value: "str", label: "STR / vacation rental" },
	{ value: "ltr", label: "Long-term residential" },
	{ value: "commercial", label: "Commercial" },
	{ value: "multifamily", label: "Multifamily" },
	{ value: "mixed_use", label: "Mixed-use" },
];

interface CreateListingDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function CreateListingDialog({
	open,
	onOpenChange,
}: CreateListingDialogProps) {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [propertyType, setPropertyType] = useState<string>("__none__");
	const [externalListingId, setExternalListingId] = useState("");

	const createMutation = useMutation(orpc.listings.create.mutationOptions());

	const reset = () => {
		setName("");
		setDescription("");
		setPropertyType("__none__");
		setExternalListingId("");
		createMutation.reset();
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const trimmedName = name.trim();
		if (trimmedName.length === 0) return;

		createMutation.mutate(
			{
				name: trimmedName,
				description: description.trim() || null,
				propertyType: propertyType === "__none__" ? null : propertyType,
				externalListingId: externalListingId.trim() || null,
			},
			{
				onSuccess: () => {
					queryClient.invalidateQueries({
						queryKey: orpc.listings.list.queryKey(),
					});
					onOpenChange(false);
					reset();
				},
				onError: (err) => {
					toastError(err.message ?? "Couldn't create the listing.");
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
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>Add a listing</DialogTitle>
						<DialogDescription>
							A listing is one property the organization manages. Workflows can be
							launched in the context of a listing, and entity-set membership (next
							step) lets you scope which workflows apply to which listings.
						</DialogDescription>
					</DialogHeader>

					<div className="mt-4 gap-4 flex flex-col">
						<div>
							<label
								className="text-sm font-medium mb-1.5 block"
								htmlFor="listing-name"
							>
								Listing name
							</label>
							<Input
								id="listing-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g. 123 Beach Dr Unit A"
								maxLength={200}
								required
								autoFocus
								disabled={createMutation.isPending}
							/>
						</div>

						<div>
							<label
								className="text-sm font-medium mb-1.5 block"
								htmlFor="listing-description"
							>
								Description{" "}
								<span className="text-foreground/50 font-normal">(optional)</span>
							</label>
							<Input
								id="listing-description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder="What this listing is (size, location, notes)"
								maxLength={2000}
								disabled={createMutation.isPending}
							/>
						</div>

						<div>
							<label
								className="text-sm font-medium mb-1.5 block"
								htmlFor="listing-property-type"
							>
								Property type
							</label>
							<Select
								value={propertyType}
								onValueChange={setPropertyType}
								disabled={createMutation.isPending}
							>
								<SelectTrigger id="listing-property-type">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{PROPERTY_TYPE_OPTIONS.map((opt) => (
										<SelectItem key={opt.value} value={opt.value}>
											{opt.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className="mt-1 text-[11px] text-foreground/50">
								A convenience hint for filters. The canonical categorization comes
								from entity-set membership (e.g. "Pet-Friendly Homes", "Class A").
							</p>
						</div>

						<div>
							<label
								className="text-sm font-medium mb-1.5 block"
								htmlFor="listing-external-id"
							>
								External listing ID{" "}
								<span className="text-foreground/50 font-normal">(optional)</span>
							</label>
							<Input
								id="listing-external-id"
								value={externalListingId}
								onChange={(e) => setExternalListingId(e.target.value)}
								placeholder="e.g. Hospitable / Guesty / OwnerRez id"
								maxLength={200}
								disabled={createMutation.isPending}
								className="font-mono text-sm"
							/>
							<p className="mt-1 text-[11px] text-foreground/50">
								Optional cross-system identifier for syncing. Unique per source within
								this organization.
							</p>
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
								name.trim().length === 0 || createMutation.isPending
							}
						>
							{createMutation.isPending && <Spinner className="size-3.5 mr-1.5" />}
							Add listing
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

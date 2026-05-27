"use client";

// EditListingDialog — patches name/description/propertyType/externalListingId. Mirrors
// CreateListingDialog but seeded with existing values; submits to listings.update.

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
import { toastError, toastSuccess } from "@virn/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

const PROPERTY_TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
	{ value: "__none__", label: "— Not specified —" },
	{ value: "str", label: "STR / vacation rental" },
	{ value: "ltr", label: "Long-term residential" },
	{ value: "commercial", label: "Commercial" },
	{ value: "multifamily", label: "Multifamily" },
	{ value: "mixed_use", label: "Mixed-use" },
];

interface EditListingDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	listingId: string;
	initialName: string;
	initialDescription: string | null;
	initialPropertyType: string | null;
	initialExternalListingId: string | null;
}

export function EditListingDialog({
	open,
	onOpenChange,
	listingId,
	initialName,
	initialDescription,
	initialPropertyType,
	initialExternalListingId,
}: EditListingDialogProps) {
	const queryClient = useQueryClient();
	const [name, setName] = useState(initialName);
	const [description, setDescription] = useState(initialDescription ?? "");
	const [propertyType, setPropertyType] = useState(
		initialPropertyType ?? "__none__",
	);
	const [externalListingId, setExternalListingId] = useState(
		initialExternalListingId ?? "",
	);

	// Reset form when dialog opens with fresh initial values (e.g. user opens a
	// different listing's edit dialog in the same session).
	useEffect(() => {
		if (open) {
			setName(initialName);
			setDescription(initialDescription ?? "");
			setPropertyType(initialPropertyType ?? "__none__");
			setExternalListingId(initialExternalListingId ?? "");
		}
	}, [
		open,
		initialName,
		initialDescription,
		initialPropertyType,
		initialExternalListingId,
	]);

	const updateMutation = useMutation(orpc.listings.update.mutationOptions());

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const trimmedName = name.trim();
		if (trimmedName.length === 0) return;

		updateMutation.mutate(
			{
				id: listingId,
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
					toastSuccess("Listing updated.");
				},
				onError: (err) => {
					toastError(err.message ?? "Couldn't update the listing.");
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
				if (!next) updateMutation.reset();
			}}
		>
			<DialogContent className="max-w-md">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>Edit listing</DialogTitle>
						<DialogDescription>
							Update this listing's display name, type hint, or external sync id.
						</DialogDescription>
					</DialogHeader>

					<div className="mt-4 gap-4 flex flex-col">
						<div>
							<label
								className="text-sm font-medium mb-1.5 block"
								htmlFor="edit-listing-name"
							>
								Listing name
							</label>
							<Input
								id="edit-listing-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								maxLength={200}
								required
								autoFocus
								disabled={updateMutation.isPending}
							/>
						</div>

						<div>
							<label
								className="text-sm font-medium mb-1.5 block"
								htmlFor="edit-listing-description"
							>
								Description{" "}
								<span className="text-foreground/50 font-normal">(optional)</span>
							</label>
							<Input
								id="edit-listing-description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								maxLength={2000}
								disabled={updateMutation.isPending}
							/>
						</div>

						<div>
							<label
								className="text-sm font-medium mb-1.5 block"
								htmlFor="edit-listing-property-type"
							>
								Property type
							</label>
							<Select
								value={propertyType}
								onValueChange={setPropertyType}
								disabled={updateMutation.isPending}
							>
								<SelectTrigger id="edit-listing-property-type">
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
						</div>

						<div>
							<label
								className="text-sm font-medium mb-1.5 block"
								htmlFor="edit-listing-external-id"
							>
								External listing ID{" "}
								<span className="text-foreground/50 font-normal">(optional)</span>
							</label>
							<Input
								id="edit-listing-external-id"
								value={externalListingId}
								onChange={(e) => setExternalListingId(e.target.value)}
								maxLength={200}
								disabled={updateMutation.isPending}
								className="font-mono text-sm"
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
								name.trim().length === 0 || updateMutation.isPending
							}
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

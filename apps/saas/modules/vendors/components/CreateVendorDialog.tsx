"use client";

// CreateVendorDialog -- name + optional description + status form. On submit, calls
// vendors.create. New vendors start with no contacts -- the row CTA reminds the admin
// they need to add at least one before the vendor can be assigned to a run.

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

type VendorStatus =
	| "active"
	| "preferred"
	| "approved"
	| "under_review"
	| "probation"
	| "blacklisted";

const STATUS_OPTIONS: ReadonlyArray<{ value: VendorStatus; label: string }> = [
	{ value: "active", label: "Active" },
	{ value: "preferred", label: "Preferred" },
	{ value: "approved", label: "Approved" },
	{ value: "under_review", label: "Under review" },
	{ value: "probation", label: "Probation" },
	{ value: "blacklisted", label: "Blacklisted" },
];

interface CreateVendorDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function CreateVendorDialog({ open, onOpenChange }: CreateVendorDialogProps) {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [status, setStatus] = useState<VendorStatus>("active");

	const createMutation = useMutation(orpc.vendors.create.mutationOptions());

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const trimmedName = name.trim();
		if (trimmedName.length === 0) return;

		createMutation.mutate(
			{
				name: trimmedName,
				description: description.trim() || null,
				status,
			},
			{
				onSuccess: () => {
					queryClient.invalidateQueries({ queryKey: orpc.vendors.list.queryKey() });
					onOpenChange(false);
					setName("");
					setDescription("");
					setStatus("active");
				},
				onError: (err) => {
					toastError(err.message ?? "Couldn't create the vendor.");
				},
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
					setDescription("");
					setStatus("active");
					createMutation.reset();
				}
				onOpenChange(next);
			}}
		>
			<DialogContent className="max-w-md">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>Add a vendor</DialogTitle>
						<DialogDescription>
							Vendors are third-party businesses you assign to specific run steps. You'll
							add at least one contact after creating the vendor.
						</DialogDescription>
					</DialogHeader>

					<div className="mt-4 gap-4 flex flex-col">
						<div>
							<label className="text-sm font-medium mb-1.5 block" htmlFor="vendor-name">
								Vendor name
							</label>
							<Input
								id="vendor-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g. Acme Pest Control"
								maxLength={120}
								required
								autoFocus
								disabled={createMutation.isPending}
							/>
						</div>

						<div>
							<label
								className="text-sm font-medium mb-1.5 block"
								htmlFor="vendor-description"
							>
								Description <span className="text-foreground/50 font-normal">(optional)</span>
							</label>
							<Input
								id="vendor-description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder="What this vendor does"
								maxLength={2000}
								disabled={createMutation.isPending}
							/>
						</div>

						<div>
							<label className="text-sm font-medium mb-1.5 block" htmlFor="vendor-status">
								Status
							</label>
							<Select
								value={status}
								onValueChange={(v) => setStatus(v as VendorStatus)}
								disabled={createMutation.isPending}
							>
								<SelectTrigger id="vendor-status">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{STATUS_OPTIONS.map((opt) => (
										<SelectItem key={opt.value} value={opt.value}>
											{opt.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className="mt-1 text-[11px] text-foreground/50">
								Preferred vendors surface first in the launcher's picker. Blacklisted
								vendors are excluded from selection.
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
							disabled={name.trim().length === 0 || createMutation.isPending}
						>
							{createMutation.isPending && <Spinner className="size-3.5 mr-1.5" />}
							Add vendor
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

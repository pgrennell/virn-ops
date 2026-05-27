"use client";

// EditVendorDialog -- patches name, description, status, isActive on an existing
// vendor. Distinct from CreateVendorDialog because the field set is similar but the
// load/initial state is different (driven by props from the row), and isActive is
// exposed here as a toggle.

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
import { Switch } from "@virn/ui/components/switch";
import { toastError, toastSuccess } from "@virn/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

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

interface EditVendorDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	vendorId: string;
	initialName: string;
	initialDescription: string | null;
	initialStatus: string;
	initialIsActive: boolean;
}

export function EditVendorDialog({
	open,
	onOpenChange,
	vendorId,
	initialName,
	initialDescription,
	initialStatus,
	initialIsActive,
}: EditVendorDialogProps) {
	const queryClient = useQueryClient();
	const [name, setName] = useState(initialName);
	const [description, setDescription] = useState(initialDescription ?? "");
	const [status, setStatus] = useState<VendorStatus>(initialStatus as VendorStatus);
	const [isActive, setIsActive] = useState(initialIsActive);

	const updateMutation = useMutation(orpc.vendors.update.mutationOptions());

	// Reset form state whenever a new vendor's edit dialog opens.
	useEffect(() => {
		if (open) {
			setName(initialName);
			setDescription(initialDescription ?? "");
			setStatus(initialStatus as VendorStatus);
			setIsActive(initialIsActive);
		}
	}, [open, initialName, initialDescription, initialStatus, initialIsActive]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const trimmedName = name.trim();
		if (trimmedName.length === 0) return;

		updateMutation.mutate(
			{
				id: vendorId,
				name: trimmedName,
				description: description.trim() || null,
				status,
				isActive,
			},
			{
				onSuccess: () => {
					queryClient.invalidateQueries({ queryKey: orpc.vendors.list.queryKey() });
					toastSuccess("Vendor updated.");
					onOpenChange(false);
				},
				onError: (err) => toastError(err.message ?? "Couldn't update the vendor."),
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
						<DialogTitle>Edit vendor</DialogTitle>
						<DialogDescription>
							Change the vendor's display details, operational status, or
							enabled/disabled state.
						</DialogDescription>
					</DialogHeader>

					<div className="mt-4 gap-4 flex flex-col">
						<div>
							<label className="text-sm font-medium mb-1.5 block" htmlFor="edit-vendor-name">
								Vendor name
							</label>
							<Input
								id="edit-vendor-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								maxLength={120}
								required
								autoFocus
								disabled={updateMutation.isPending}
							/>
						</div>

						<div>
							<label
								className="text-sm font-medium mb-1.5 block"
								htmlFor="edit-vendor-description"
							>
								Description{" "}
								<span className="text-foreground/50 font-normal">(optional)</span>
							</label>
							<Input
								id="edit-vendor-description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								maxLength={2000}
								disabled={updateMutation.isPending}
							/>
						</div>

						<div>
							<label
								className="text-sm font-medium mb-1.5 block"
								htmlFor="edit-vendor-status"
							>
								Status
							</label>
							<Select
								value={status}
								onValueChange={(v) => setStatus(v as VendorStatus)}
								disabled={updateMutation.isPending}
							>
								<SelectTrigger id="edit-vendor-status">
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
						</div>

						<div className="gap-3 flex items-start py-1">
							<Switch
								id="edit-vendor-active"
								checked={isActive}
								onCheckedChange={setIsActive}
								disabled={updateMutation.isPending}
							/>
							<div className="gap-0.5 flex flex-col">
								<label
									htmlFor="edit-vendor-active"
									className="text-sm font-medium cursor-pointer"
								>
									{isActive ? "Enabled" : "Disabled"}
								</label>
								<p className="text-[11px] text-foreground/50">
									{isActive
										? "Visible to launchers; selectable as a step assignee."
										: "Hidden from new picker selections. Historical runs are unaffected."}
								</p>
							</div>
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
							disabled={name.trim().length === 0 || updateMutation.isPending}
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

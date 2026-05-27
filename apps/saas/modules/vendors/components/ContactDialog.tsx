"use client";

// ContactDialog -- shared create/edit form for vendor contacts. Used by
// ManageContactsDialog for both "Add contact" (mode=create) and "Edit contact"
// (mode=edit). Pulls name + email + phone + role + isPrimary + (edit-only) isActive.

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
import { Switch } from "@virn/ui/components/switch";
import { toastError, toastSuccess } from "@virn/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

export interface ContactInitial {
	id: string;
	name: string;
	email: string;
	phone: string | null;
	role: string | null;
	isPrimary: boolean;
	isActive: boolean;
}

interface ContactDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	vendorId: string;
	/** When provided, the dialog is in edit mode; when null, create mode. */
	initial: ContactInitial | null;
}

export function ContactDialog({ open, onOpenChange, vendorId, initial }: ContactDialogProps) {
	const queryClient = useQueryClient();
	const isEdit = initial !== null;

	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [phone, setPhone] = useState("");
	const [role, setRole] = useState("");
	const [isPrimary, setIsPrimary] = useState(false);
	const [isActive, setIsActive] = useState(true);

	useEffect(() => {
		if (open) {
			setName(initial?.name ?? "");
			setEmail(initial?.email ?? "");
			setPhone(initial?.phone ?? "");
			setRole(initial?.role ?? "");
			setIsPrimary(initial?.isPrimary ?? false);
			setIsActive(initial?.isActive ?? true);
		}
	}, [open, initial]);

	const createMutation = useMutation(orpc.vendors.createContact.mutationOptions());
	const updateMutation = useMutation(orpc.vendors.updateContact.mutationOptions());
	const isPending = createMutation.isPending || updateMutation.isPending;

	const invalidate = () => {
		queryClient.invalidateQueries({ queryKey: orpc.vendors.list.queryKey() });
		queryClient.invalidateQueries({
			queryKey: orpc.vendors.get.queryKey({ input: { id: vendorId } }),
		});
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const trimmedName = name.trim();
		const trimmedEmail = email.trim();
		if (trimmedName.length === 0 || trimmedEmail.length === 0) return;

		if (isEdit && initial) {
			updateMutation.mutate(
				{
					vendorId,
					contactId: initial.id,
					name: trimmedName,
					email: trimmedEmail,
					phone: phone.trim() || null,
					role: role.trim() || null,
					isPrimary,
					isActive,
				},
				{
					onSuccess: () => {
						invalidate();
						toastSuccess("Contact updated.");
						onOpenChange(false);
					},
					onError: (err) => toastError(err.message ?? "Couldn't update the contact."),
				},
			);
		} else {
			createMutation.mutate(
				{
					vendorId,
					name: trimmedName,
					email: trimmedEmail,
					phone: phone.trim() || null,
					role: role.trim() || null,
					isPrimary,
				},
				{
					onSuccess: () => {
						invalidate();
						toastSuccess("Contact added.");
						onOpenChange(false);
					},
					onError: (err) => toastError(err.message ?? "Couldn't add the contact."),
				},
			);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (isPending) return;
				if (!next) {
					createMutation.reset();
					updateMutation.reset();
				}
				onOpenChange(next);
			}}
		>
			<DialogContent className="max-w-md">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>{isEdit ? "Edit contact" : "Add contact"}</DialogTitle>
						<DialogDescription>
							{isEdit
								? "Update this contact's details."
								: "Add a person at this vendor who can be assigned to run steps. They'll act via a tokenized link — no login required."}
						</DialogDescription>
					</DialogHeader>

					<div className="mt-4 gap-4 flex flex-col">
						<div>
							<label className="text-sm font-medium mb-1.5 block" htmlFor="contact-name">
								Name
							</label>
							<Input
								id="contact-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g. Mike Smith"
								maxLength={160}
								required
								autoFocus
								disabled={isPending}
							/>
						</div>

						<div>
							<label className="text-sm font-medium mb-1.5 block" htmlFor="contact-email">
								Email
							</label>
							<Input
								id="contact-email"
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder="e.g. mike@acme.example"
								required
								disabled={isPending}
							/>
							<p className="mt-1 text-[11px] text-foreground/50">
								This contact's tokenized run-portal links go to this address.
							</p>
						</div>

						<div className="gap-3 grid grid-cols-2">
							<div>
								<label className="text-sm font-medium mb-1.5 block" htmlFor="contact-phone">
									Phone <span className="text-foreground/50 font-normal">(optional)</span>
								</label>
								<Input
									id="contact-phone"
									value={phone}
									onChange={(e) => setPhone(e.target.value)}
									maxLength={80}
									disabled={isPending}
								/>
							</div>
							<div>
								<label className="text-sm font-medium mb-1.5 block" htmlFor="contact-role">
									Role <span className="text-foreground/50 font-normal">(optional)</span>
								</label>
								<Input
									id="contact-role"
									value={role}
									onChange={(e) => setRole(e.target.value)}
									placeholder="e.g. Dispatcher"
									maxLength={120}
									disabled={isPending}
								/>
							</div>
						</div>

						<div className="gap-3 flex items-start py-1">
							<Switch
								id="contact-primary"
								checked={isPrimary}
								onCheckedChange={setIsPrimary}
								disabled={isPending}
							/>
							<div className="gap-0.5 flex flex-col">
								<label
									htmlFor="contact-primary"
									className="text-sm font-medium cursor-pointer"
								>
									Primary contact
								</label>
								<p className="text-[11px] text-foreground/50">
									Default contact for new runs. Each vendor has at most one primary —
									enabling here demotes any existing one.
								</p>
							</div>
						</div>

						{isEdit && (
							<div className="gap-3 flex items-start py-1">
								<Switch
									id="contact-active"
									checked={isActive}
									onCheckedChange={setIsActive}
									disabled={isPending}
								/>
								<div className="gap-0.5 flex flex-col">
									<label
										htmlFor="contact-active"
										className="text-sm font-medium cursor-pointer"
									>
										{isActive ? "Enabled" : "Disabled"}
									</label>
									<p className="text-[11px] text-foreground/50">
										{isActive
											? "Visible in the launcher's contact picker."
											: "Hidden from new picker selections. Historical participant rows are preserved."}
									</p>
								</div>
							</div>
						)}
					</div>

					<DialogFooter className="mt-6">
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							disabled={isPending}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="primary"
							disabled={
								name.trim().length === 0 || email.trim().length === 0 || isPending
							}
						>
							{isPending && <Spinner className="size-3.5 mr-1.5" />}
							{isEdit ? "Save changes" : "Add contact"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

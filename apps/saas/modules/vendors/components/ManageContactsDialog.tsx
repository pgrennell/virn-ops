"use client";

// ManageContactsDialog -- opened from VendorRowMenu's "Manage contacts" action. Fetches
// the full vendor (with its contacts list) via vendors.get and lets the admin add new
// contacts, edit existing ones, mark one as primary, or disable. Edits are routed
// through ContactDialog. No delete -- soft-disable via isActive is the only path
// (mirrors agent disable pattern + preserves historical participant FKs).

import { Button } from "@virn/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@virn/ui/components/dialog";
import { Spinner } from "@virn/ui/components/spinner";
import { toastError, toastSuccess } from "@virn/ui/components/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Power, Star, UserPlus } from "lucide-react";
import { useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

import { ContactDialog, type ContactInitial } from "./ContactDialog";

interface ManageContactsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	vendorId: string;
	vendorName: string;
}

export function ManageContactsDialog({
	open,
	onOpenChange,
	vendorId,
	vendorName,
}: ManageContactsDialogProps) {
	const queryClient = useQueryClient();

	const vendorQuery = useQuery({
		...orpc.vendors.get.queryOptions({ input: { id: vendorId } }),
		enabled: open,
	});

	const updateContactMutation = useMutation(orpc.vendors.updateContact.mutationOptions());

	const [contactDialogOpen, setContactDialogOpen] = useState(false);
	const [editing, setEditing] = useState<ContactInitial | null>(null);

	const handleAdd = () => {
		setEditing(null);
		setContactDialogOpen(true);
	};

	const handleEdit = (c: ContactInitial) => {
		setEditing(c);
		setContactDialogOpen(true);
	};

	const handleTogglePrimary = (contactId: string, willBePrimary: boolean) => {
		updateContactMutation.mutate(
			{ vendorId, contactId, isPrimary: willBePrimary },
			{
				onSuccess: () => {
					queryClient.invalidateQueries({
						queryKey: orpc.vendors.get.queryKey({ input: { id: vendorId } }),
					});
					queryClient.invalidateQueries({ queryKey: orpc.vendors.list.queryKey() });
					toastSuccess(willBePrimary ? "Set as primary contact." : "Removed primary flag.");
				},
				onError: (err) => toastError(err.message ?? "Couldn't update contact."),
			},
		);
	};

	const handleToggleActive = (contactId: string, willBeActive: boolean) => {
		updateContactMutation.mutate(
			{ vendorId, contactId, isActive: willBeActive },
			{
				onSuccess: () => {
					queryClient.invalidateQueries({
						queryKey: orpc.vendors.get.queryKey({ input: { id: vendorId } }),
					});
					queryClient.invalidateQueries({ queryKey: orpc.vendors.list.queryKey() });
					toastSuccess(willBeActive ? "Contact enabled." : "Contact disabled.");
				},
				onError: (err) => toastError(err.message ?? "Couldn't update contact."),
			},
		);
	};

	const contacts = vendorQuery.data?.contacts ?? [];

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>{vendorName} — Contacts</DialogTitle>
						<DialogDescription>
							The specific humans at this vendor. Each contact gets a tokenized portal
							link when assigned to a run step — no account required. At least one
							contact is required before this vendor can be assigned to a run.
						</DialogDescription>
					</DialogHeader>

					<div className="mt-2 gap-3 flex flex-col">
						<div className="flex justify-end">
							<Button variant="primary" size="sm" onClick={handleAdd}>
								<Plus className="size-3.5 mr-1.5" />
								Add contact
							</Button>
						</div>

						{vendorQuery.isLoading && (
							<div className="py-8 text-foreground/50 gap-2 flex items-center justify-center">
								<Spinner className="size-4" />
								<span className="text-sm">Loading contacts…</span>
							</div>
						)}

						{vendorQuery.isError && (
							<div className="py-6 text-sm text-destructive">
								Couldn't load contacts. {vendorQuery.error?.message}
							</div>
						)}

						{!vendorQuery.isLoading && !vendorQuery.isError && contacts.length === 0 && (
							<div className="py-10 px-4 rounded-md border border-dashed border-border gap-3 flex flex-col items-center text-center">
								<UserPlus className="size-7 text-foreground/40" />
								<div>
									<p className="font-medium text-sm">No contacts yet</p>
									<p className="mt-1 text-xs text-foreground/60 max-w-sm">
										Add a contact to make this vendor assignable to a run step.
									</p>
								</div>
								<Button variant="primary" size="sm" onClick={handleAdd}>
									<Plus className="size-3.5 mr-1.5" />
									Add the first contact
								</Button>
							</div>
						)}

						{contacts.length > 0 && (
							<ul className="divide-y divide-border border border-border rounded-md overflow-hidden">
								{contacts.map((c) => (
									<li
										key={c.id}
										className="px-3 py-2.5 gap-3 flex items-center bg-background"
									>
										<div className="flex-1 min-w-0 gap-0.5 flex flex-col">
											<div className="gap-2 flex items-center">
												<span
													className={`font-medium text-sm truncate ${!c.isActive ? "text-foreground/50" : ""}`}
												>
													{c.name}
												</span>
												{c.isPrimary && c.isActive && (
													<span className="shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 font-medium uppercase tracking-wide gap-1 flex items-center">
														<Star className="size-2.5" />
														Primary
													</span>
												)}
												{!c.isActive && (
													<span className="shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-muted text-foreground/60 font-medium uppercase tracking-wide">
														Disabled
													</span>
												)}
											</div>
											<p className="text-xs text-foreground/60 truncate">
												<span className="font-mono">{c.email}</span>
												{c.role && <> · {c.role}</>}
												{c.phone && <> · {c.phone}</>}
											</p>
										</div>
										<div className="gap-1 flex items-center shrink-0">
											{c.isActive && !c.isPrimary && (
												<Button
													variant="ghost"
													size="sm"
													onClick={() => handleTogglePrimary(c.id, true)}
													disabled={updateContactMutation.isPending}
													aria-label={`Set ${c.name} as primary`}
												>
													<Star className="size-3.5" />
												</Button>
											)}
											<Button
												variant="ghost"
												size="sm"
												onClick={() => handleToggleActive(c.id, !c.isActive)}
												disabled={updateContactMutation.isPending}
												aria-label={c.isActive ? `Disable ${c.name}` : `Enable ${c.name}`}
											>
												<Power
													className={`size-3.5 ${c.isActive ? "" : "text-foreground/40"}`}
												/>
											</Button>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => handleEdit(c)}
											>
												Edit
											</Button>
										</div>
									</li>
								))}
							</ul>
						)}
					</div>

					<DialogFooter className="mt-4">
						<Button variant="ghost" onClick={() => onOpenChange(false)}>
							Close
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<ContactDialog
				open={contactDialogOpen}
				onOpenChange={setContactDialogOpen}
				vendorId={vendorId}
				initial={editing}
			/>
		</>
	);
}

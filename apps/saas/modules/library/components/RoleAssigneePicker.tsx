"use client";

// RoleAssigneePicker -- per-role assignee picker for the LauncherForm. Single Select
// that combines:
//   - "Unassigned" (default)
//   - "Members" group  -- one item per org member
//   - "Vendors" group  -- one item per (vendor, contact) combination
//                         ("Acme Pest Control — Mike Smith")
//
// Vendor support is the Phase 8 follow-on per ADR-007 + D-023. Server-side launchRun
// validates that the picked (vendorId, vendorContactId) exists in the org and the
// vendor isn't blacklisted / disabled / contact-disabled; this picker only surfaces
// active+non-blacklisted vendors with active contacts (the vendors.listForLauncher
// query pre-filters at the DB layer).
//
// Value encoding inside the Select:
//   __none__                                  -> unassigned
//   user:<userId>                             -> user assignment
//   vendor:<vendorId>:<vendorContactId>       -> vendor + contact assignment
//
// The parent component (LauncherForm) decodes back into a typed AssigneeChoice. This
// component is purely presentational -- it knows nothing about runs.launch or audit.

import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "@virn/ui/components/select";
import { useQuery } from "@tanstack/react-query";

import { orpc } from "@shared/lib/orpc-query-utils";

export type AssigneeChoice =
	| { kind: "user"; userId: string }
	| { kind: "vendor"; vendorId: string; vendorContactId: string };

export function encodeAssigneeChoice(c: AssigneeChoice | null): string {
	if (!c) return "__none__";
	if (c.kind === "user") return `user:${c.userId}`;
	return `vendor:${c.vendorId}:${c.vendorContactId}`;
}

export function decodeAssigneeChoice(v: string): AssigneeChoice | null {
	if (v === "__none__" || v === "") return null;
	if (v.startsWith("user:")) {
		return { kind: "user", userId: v.slice("user:".length) };
	}
	if (v.startsWith("vendor:")) {
		const rest = v.slice("vendor:".length);
		const sep = rest.indexOf(":");
		if (sep === -1) return null;
		return {
			kind: "vendor",
			vendorId: rest.slice(0, sep),
			vendorContactId: rest.slice(sep + 1),
		};
	}
	return null;
}

interface Member {
	userId: string;
	name: string | null;
	email: string;
}

interface RoleAssigneePickerProps {
	value: AssigneeChoice | null;
	onChange: (next: AssigneeChoice | null) => void;
	members: ReadonlyArray<Member>;
	disabled?: boolean;
	placeholder?: string;
}

export function RoleAssigneePicker({
	value,
	onChange,
	members,
	disabled,
	placeholder = "Unassigned",
}: RoleAssigneePickerProps) {
	// Vendor list comes from vendors.listForLauncher -- pre-filtered to active +
	// non-blacklisted vendors with their active contacts joined. Empty result on
	// fresh orgs / orgs without vendor management is the dominant case at v1, so
	// the Vendors group simply doesn't render in that case.
	const vendorsQuery = useQuery(orpc.vendors.listForLauncher.queryOptions({ input: {} }));
	const vendors = vendorsQuery.data ?? [];

	// Surface vendors that exist but have no active contacts as a disabled informational
	// row -- helps the admin spot "Acme is registered but has no usable contact yet"
	// without leaving the launcher (mirrors the LaunchModePicker's tell-the-user-why
	// posture from UX_SPEC §2).
	const vendorsWithContacts = vendors.filter((v) => v.contacts.length > 0);
	const vendorsWithoutContacts = vendors.filter((v) => v.contacts.length === 0);

	return (
		<Select
			value={encodeAssigneeChoice(value)}
			onValueChange={(v) => onChange(decodeAssigneeChoice(v))}
			disabled={disabled}
		>
			<SelectTrigger>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="__none__">Unassigned</SelectItem>

				{members.length > 0 && (
					<>
						<SelectSeparator />
						<SelectGroup>
							<SelectLabel className="text-[10px] uppercase tracking-wide text-foreground/50 font-medium">
								Members
							</SelectLabel>
							{members.map((m) => (
								<SelectItem key={m.userId} value={`user:${m.userId}`}>
									{m.name ?? m.email}{" "}
									{m.name && (
										<span className="text-foreground/40">({m.email})</span>
									)}
								</SelectItem>
							))}
						</SelectGroup>
					</>
				)}

				{vendorsWithContacts.length > 0 && (
					<>
						<SelectSeparator />
						<SelectGroup>
							<SelectLabel className="text-[10px] uppercase tracking-wide text-foreground/50 font-medium">
								Vendors
							</SelectLabel>
							{vendorsWithContacts.flatMap((v) =>
								v.contacts.map((c) => (
									<SelectItem
										key={`${v.id}:${c.id}`}
										value={`vendor:${v.id}:${c.id}`}
									>
										{v.name} — {c.name}
										{v.status === "preferred" && (
											<span className="ml-1.5 px-1 py-0.5 text-[9px] rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-medium uppercase tracking-wide">
												Preferred
											</span>
										)}
										{c.isPrimary && (
											<span className="ml-1.5 text-[10px] text-foreground/50">
												(primary)
											</span>
										)}
									</SelectItem>
								)),
							)}
						</SelectGroup>
					</>
				)}

				{/* Show vendors with no active contacts in a separate "needs setup" group --
				    disabled rows so the admin sees them but can't pick. */}
				{vendorsWithoutContacts.length > 0 && (
					<>
						<SelectSeparator />
						<SelectGroup>
							<SelectLabel className="text-[10px] uppercase tracking-wide text-foreground/50 font-medium">
								Vendors — needs a contact
							</SelectLabel>
							{vendorsWithoutContacts.map((v) => (
								<SelectItem key={v.id} value={`vendor_disabled:${v.id}`} disabled>
									{v.name}{" "}
									<span className="text-foreground/40">(no active contact)</span>
								</SelectItem>
							))}
						</SelectGroup>
					</>
				)}
			</SelectContent>
		</Select>
	);
}

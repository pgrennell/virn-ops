"use client";

// VendorsPanel -- top-level client component for the /settings/vendors page. Orchestrates
// the vendor list + create button + the row menu (which opens contacts/edit dialogs).
// Per ADR-007 + D-023: vendors are a vertical-agnostic Ops primitive used by the
// launcher's vendor picker (next chunk). Contacts must be added before a vendor can be
// assigned to a run (participant CHECK requires both vendorId AND vendorContactId).

import { Button } from "@virn/ui/components/button";
import { Spinner } from "@virn/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, Plus } from "lucide-react";
import { useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

import { CreateVendorDialog } from "./CreateVendorDialog";
import { VendorRowMenu } from "./VendorRowMenu";

const STATUS_BADGE_STYLES: Record<string, string> = {
	preferred: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
	approved: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
	under_review: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
	probation: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
	blacklisted: "bg-red-500/15 text-red-700 dark:text-red-400",
};

function StatusBadge({ status }: { status: string }) {
	// 'active' is the default state -- skip the badge to reduce visual noise.
	if (status === "active") return null;
	const cls = STATUS_BADGE_STYLES[status] ?? "bg-muted text-foreground/70";
	const label = status.replace(/_/g, " ");
	return (
		<span className={`shrink-0 px-1.5 py-0.5 text-[10px] rounded font-medium uppercase tracking-wide ${cls}`}>
			{label}
		</span>
	);
}

export function VendorsPanel() {
	const vendorsQuery = useQuery(orpc.vendors.list.queryOptions({ input: {} }));
	const [createOpen, setCreateOpen] = useState(false);

	const vendors = vendorsQuery.data ?? [];

	return (
		<>
			<div className="gap-4 flex items-start justify-between mb-6">
				<div>
					<h2 className="font-medium text-lg mb-1">Vendors</h2>
					<p className="text-sm text-foreground/60 max-w-2xl leading-relaxed">
						Third-party businesses that can be assigned to vendor-fulfilled run steps —
						pest control, HVAC, plumbing, landscaping, MSPs, agencies, contractors. Each
						vendor has one or more contacts (the specific humans who act on the vendor's
						behalf via tokenized run links).
					</p>
				</div>
				<Button
					variant="primary"
					size="sm"
					onClick={() => setCreateOpen(true)}
					className="shrink-0"
				>
					<Plus className="size-3.5 mr-1.5" />
					New vendor
				</Button>
			</div>

			{vendorsQuery.isLoading && (
				<div className="py-12 text-foreground/50 gap-2 flex items-center justify-center">
					<Spinner className="size-4" />
					<span className="text-sm">Loading vendors…</span>
				</div>
			)}

			{vendorsQuery.isError && (
				<div className="py-8 text-sm text-destructive">
					Couldn't load vendors. {vendorsQuery.error?.message}
				</div>
			)}

			{!vendorsQuery.isLoading && !vendorsQuery.isError && vendors.length === 0 && (
				<div className="py-16 px-6 rounded-md border border-dashed border-border gap-3 flex flex-col items-center text-center">
					<Briefcase className="size-8 text-foreground/40" />
					<div>
						<p className="font-medium text-sm">No vendors yet</p>
						<p className="mt-1 text-xs text-foreground/60 max-w-sm">
							Add a vendor to make it pickable as a step assignee in the launcher. Each
							vendor needs at least one contact before it can be assigned to a run.
						</p>
					</div>
					<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
						<Plus className="size-3.5 mr-1.5" />
						Add your first vendor
					</Button>
				</div>
			)}

			{vendors.length > 0 && (
				<ul className="divide-y divide-border border border-border rounded-md overflow-hidden">
					{vendors.map((v) => (
						<li key={v.id} className="px-4 py-3 gap-3 flex items-center bg-background">
							<div className="size-9 shrink-0 rounded-md bg-muted gap-0 flex items-center justify-center">
								<Briefcase
									className={`size-4 ${v.isActive ? "text-foreground/70" : "text-foreground/30"}`}
								/>
							</div>
							<div className="flex-1 min-w-0 gap-0.5 flex flex-col">
								<div className="gap-2 flex items-center">
									<span className="font-medium text-sm truncate">{v.name}</span>
									<StatusBadge status={v.status} />
									{!v.isActive && (
										<span className="shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-muted text-foreground/60 font-medium uppercase tracking-wide">
											Disabled
										</span>
									)}
								</div>
								{v.description && (
									<p className="text-xs text-foreground/60 truncate">{v.description}</p>
								)}
								<p className="text-[11px] text-foreground/40">
									{v.contactCount === 0 ? (
										<span className="text-amber-700 dark:text-amber-400">
											No contacts — can't be assigned yet
										</span>
									) : (
										<>
											{v.contactCount} {v.contactCount === 1 ? "contact" : "contacts"}
											{v.primaryContactName && <> · primary: {v.primaryContactName}</>}
										</>
									)}
									{v.createdByUserName && <> · added by {v.createdByUserName}</>}
								</p>
							</div>
							<VendorRowMenu
								vendorId={v.id}
								vendorName={v.name}
								isActive={v.isActive}
								status={v.status}
								description={v.description}
							/>
						</li>
					))}
				</ul>
			)}

			<CreateVendorDialog open={createOpen} onOpenChange={setCreateOpen} />
		</>
	);
}

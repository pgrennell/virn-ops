"use client";

// Phase 15 -- single acknowledgment receipt. The compliance proof: org +
// workflow + version + user + timestamp on a single printable surface.
//
// Includes a small per-entity audit timeline below (reusing AuditTimelineView)
// so any state changes attached to this acknowledgment id are surfaced.
// Today the only audit row is the insert; once Phase 16's acknowledge
// action surface ships, the action will write into the same audit log.

import { AuditTimelineView } from "@compliance/components/AuditTimelineView";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Badge } from "@virn/ui/components/badge";
import { Button } from "@virn/ui/components/button";
import { Skeleton } from "@virn/ui/components/skeleton";
import { CheckCircle2, ChevronLeft, Printer } from "lucide-react";
import Link from "next/link";

interface AcknowledgmentReceiptViewProps {
	organizationSlug: string;
	acknowledgmentId: string;
}

export function AcknowledgmentReceiptView({
	organizationSlug,
	acknowledgmentId,
}: AcknowledgmentReceiptViewProps) {
	const receipt = useQuery(
		orpc.acknowledgments.get.queryOptions({ input: { acknowledgmentId } }),
	);

	if (receipt.isLoading) {
		return <ReceiptSkeleton />;
	}
	if (receipt.isError) {
		return (
			<Alert variant="error">
				<AlertDescription>
					Couldn't load receipt: {receipt.error?.message ?? "unknown error"}
				</AlertDescription>
			</Alert>
		);
	}
	if (!receipt.data) {
		return <div className="text-sm text-foreground/60">Receipt not found.</div>;
	}

	const r = receipt.data;
	const date = typeof r.acknowledgedAt === "string"
		? new Date(r.acknowledgedAt)
		: r.acknowledgedAt;

	return (
		<div className="max-w-3xl mx-auto gap-4 flex flex-col">
			<div className="flex items-center justify-between print:hidden">
				<Link
					href={`/${organizationSlug}/compliance/acknowledgments`}
					className="inline-flex items-center gap-1 text-xs text-foreground/60 hover:text-foreground"
				>
					<ChevronLeft className="size-3" />
					Acknowledgments
				</Link>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => window.print()}
					className="text-xs"
				>
					<Printer className="size-3 mr-1" />
					Print
				</Button>
			</div>

			<article className="rounded-lg border border-border bg-background p-6 gap-4 flex flex-col print:border-none print:p-0">
				<header className="gap-2 flex items-start justify-between">
					<div className="min-w-0">
						<div className="text-[10px] uppercase tracking-wide text-foreground/50">
							Acknowledgment receipt
						</div>
						<h1 className="font-medium text-lg mt-1">{r.workflowTitle}</h1>
						<div className="text-xs text-foreground/60 mt-1">{r.organizationName}</div>
					</div>
					<Badge status="success">
						<CheckCircle2 className="size-3 mr-1 inline align-text-top" />
						Acknowledged
					</Badge>
				</header>

				{r.workflowDescription && (
					<p className="text-sm text-foreground/70 whitespace-pre-wrap border-l-2 border-border pl-3">
						{r.workflowDescription}
					</p>
				)}

				<dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm border-t border-border pt-4">
					<ReceiptField label="Workflow version" value={`v${r.workflowVersionNumber}`} />
					<ReceiptField
						label="Workflow type"
						value={r.workflowType.charAt(0).toUpperCase() + r.workflowType.slice(1)}
					/>
					<ReceiptField label="User" value={r.userName ?? r.userEmail} />
					<ReceiptField label="Email" value={r.userEmail} />
					<ReceiptField
						label="Acknowledged at"
						value={date.toLocaleString()}
					/>
					<ReceiptField label="Receipt id" value={r.id} mono />
				</dl>

				<div className="text-[10px] text-foreground/40 border-t border-border pt-3 mt-2 font-mono">
					Workflow id: {r.workflowId} · Version id: {r.workflowVersionId} · User id: {r.userId}
				</div>
			</article>

			<section className="rounded-lg border border-border bg-background overflow-hidden">
				<header className="px-4 py-3 border-b border-border">
					<h2 className="font-medium text-sm">Audit history</h2>
					<p className="text-xs text-foreground/60 mt-0.5">
						Any state changes attached to this acknowledgment id.
					</p>
				</header>
				<AuditTimelineView
					entityType="acknowledgment"
					entityId={r.id}
					initialPage={1}
					emptyStateLabel="No additional audit history yet -- the insert itself was the only event."
				/>
			</section>
		</div>
	);
}

function ReceiptField({
	label,
	value,
	mono,
}: {
	label: string;
	value: string;
	mono?: boolean;
}) {
	return (
		<div>
			<dt className="text-[10px] uppercase tracking-wide text-foreground/50">{label}</dt>
			<dd className={`text-foreground mt-0.5 ${mono ? "font-mono text-xs" : ""}`}>
				{value}
			</dd>
		</div>
	);
}

function ReceiptSkeleton() {
	return (
		<div className="max-w-3xl mx-auto gap-3 flex flex-col">
			<Skeleton className="h-4 w-32" />
			<Skeleton className="h-60 w-full" />
			<Skeleton className="h-40 w-full" />
		</div>
	);
}

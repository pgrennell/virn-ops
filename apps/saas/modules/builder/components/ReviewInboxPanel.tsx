"use client";

// ReviewInboxPanel -- admin-only concierge review queue (Phase 9.5g / PRD §6.6).
// Lists workflows currently in review_state='in_review' with their pending-draft
// + last-published version numbers. Each row links into the Builder where the
// admin can approve / send back via the top-bar buttons (9.5g BuilderTopBar
// behavior shipped alongside this).
//
// Deliberately minimal: no in-row approve/send-back actions, no diff view --
// those live in the Builder where the full content is visible. The inbox is a
// triage surface, not a one-click approval surface.

import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Button } from "@virn/ui/components/button";
import { Spinner } from "@virn/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileCheck2 } from "lucide-react";
import Link from "next/link";

import { orpc } from "@shared/lib/orpc-query-utils";

interface ReviewInboxPanelProps {
	organizationSlug: string;
	requireConciergeReview: boolean;
}

function formatPendingFor(updatedAt: Date | string): string {
	const ts = typeof updatedAt === "string" ? new Date(updatedAt) : updatedAt;
	const days = Math.floor((Date.now() - ts.getTime()) / (1000 * 60 * 60 * 24));
	if (days < 1) return "Today";
	if (days === 1) return "1 day";
	return `${days} days`;
}

export function ReviewInboxPanel({
	organizationSlug,
	requireConciergeReview,
}: ReviewInboxPanelProps) {
	const reviewsQuery = useQuery(orpc.workflows.listForReview.queryOptions({}));
	const reviews = reviewsQuery.data ?? [];

	return (
		<>
			{!requireConciergeReview && (
				<Alert variant="default" className="mb-6">
					<AlertDescription className="text-xs">
						Concierge review isn't enabled for this organization. Authors can publish
						directly. Turn it on in{" "}
						<Link
							href={`/${organizationSlug}/settings/general`}
							className="underline hover:text-foreground"
						>
							Settings → General
						</Link>{" "}
						to require an admin checkpoint between drafts and publishes.
					</AlertDescription>
				</Alert>
			)}

			{reviewsQuery.isLoading && (
				<div className="py-12 text-foreground/50 gap-2 flex items-center justify-center">
					<Spinner className="size-4" />
					<span className="text-sm">Loading review queue…</span>
				</div>
			)}

			{reviewsQuery.isError && (
				<div className="py-8 text-sm text-destructive">
					Couldn't load reviews. {reviewsQuery.error?.message}
				</div>
			)}

			{!reviewsQuery.isLoading && !reviewsQuery.isError && reviews.length === 0 && (
				<div className="py-16 px-6 rounded-md border border-dashed border-border gap-3 flex flex-col items-center text-center">
					<FileCheck2 className="size-8 text-foreground/40" />
					<div>
						<p className="font-medium text-sm">No workflows pending review</p>
						<p className="mt-1 text-xs text-foreground/60 max-w-sm">
							When authors submit a draft for review, it shows up here. Open the
							workflow to approve or send back from the top-bar.
						</p>
					</div>
				</div>
			)}

			{reviews.length > 0 && (
				<ul className="divide-y divide-border border border-border rounded-md overflow-hidden">
					{reviews.map((r) => {
						const draftLabel =
							r.currentDraftVersionNumber !== null
								? `Draft v${r.currentDraftVersionNumber}`
								: "Draft missing";
						const pubLabel =
							r.latestPublishedVersionNumber !== null
								? `current: v${r.latestPublishedVersionNumber}`
								: "no published version";
						return (
							<li
								key={r.id}
								className="px-4 py-3 gap-3 flex items-center bg-background"
							>
								<div className="size-9 shrink-0 rounded-md bg-muted gap-0 flex items-center justify-center">
									<FileCheck2 className="size-4 text-foreground/70" />
								</div>
								<div className="flex-1 min-w-0 gap-0.5 flex flex-col">
									<div className="gap-2 flex items-center flex-wrap">
										<span className="font-medium text-sm truncate">{r.title}</span>
										<span className="shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-indigo-100 text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-300 font-medium uppercase tracking-wide">
											In review
										</span>
										<span className="shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-muted text-foreground/70 font-medium uppercase tracking-wide">
											{r.type}
										</span>
									</div>
									{r.description && (
										<p className="text-xs text-foreground/60 truncate">
											{r.description}
										</p>
									)}
									<p className="text-[11px] text-foreground/40">
										{draftLabel} · {pubLabel} · pending {formatPendingFor(r.updatedAt)}
									</p>
								</div>
								<Link
									href={`/${organizationSlug}/library/workflows/${r.id}/builder`}
								>
									<Button variant="secondary" size="sm" className="shrink-0">
										<ExternalLink className="size-3.5 mr-1.5" />
										Open in Builder
									</Button>
								</Link>
							</li>
						);
					})}
				</ul>
			)}
		</>
	);
}

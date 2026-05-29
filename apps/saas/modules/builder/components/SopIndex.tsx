"use client";

// Phase 10 / v1.5c (PRD §6.4) -- the readers' index of published workflows.
//
// Browses `workflows.list` filtered to those with at least one published
// version. Search by title (client-side filter against the loaded list).
// Each row routes to the workflow detail page in Read view.
//
// What this is NOT:
//   - A full search engine. v1.5c uses client-side substring matching on the
//     loaded list. Full-text search across step descriptions + field labels
//     is a Phase 15 enrichment.
//   - A status board. The /library authors' index handles draft / review
//     states. /sop only shows what's actually published.

import { Input } from "@virn/ui/components/input";
import { Spinner } from "@virn/ui/components/spinner";
import { cn } from "@virn/ui";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronRight, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

interface SopIndexProps {
	organizationSlug: string;
}

export function SopIndex({ organizationSlug }: SopIndexProps) {
	const [search, setSearch] = useState("");

	// The workflows.list response carries everything we need: title, type,
	// description, latestPublishedVersionNumber, aiAuthored. We filter to
	// rows with a published version client-side.
	const listQuery = useQuery(
		orpc.workflows.list.queryOptions({ input: {} }),
	);

	const publishedRows = useMemo(() => {
		if (!listQuery.data) return [];
		return listQuery.data.filter(
			(w) => w.latestPublishedVersionNumber !== null,
		);
	}, [listQuery.data]);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (q.length === 0) return publishedRows;
		return publishedRows.filter((w) => {
			if (w.title.toLowerCase().includes(q)) return true;
			if (w.description && w.description.toLowerCase().includes(q)) return true;
			return false;
		});
	}, [publishedRows, search]);

	return (
		<article className="mx-auto max-w-4xl px-4 py-4 flex flex-col gap-4">
			<header className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold">SOPs</h1>
				<p className="text-sm text-foreground/60">
					Browse published procedures, documents, and policies. Click a row to
					read the SOP and mark it read.
				</p>
			</header>

			<div className="relative">
				<Search
					className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-foreground/40"
					aria-hidden="true"
				/>
				<Input
					type="search"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					placeholder="Search by title or description…"
					className="pl-9"
					aria-label="Search published SOPs"
				/>
			</div>

			{listQuery.isLoading && (
				<div className="flex items-center justify-center gap-3 py-12 text-foreground/60">
					<Spinner className="size-4" /> Loading SOPs…
				</div>
			)}

			{listQuery.isError && (
				<EmptyState
					title="Couldn't load SOPs"
					description={
						listQuery.error instanceof Error
							? listQuery.error.message
							: "Something went wrong loading the SOP list."
					}
				/>
			)}

			{!listQuery.isLoading && !listQuery.isError && publishedRows.length === 0 && (
				<EmptyState
					title="No published SOPs yet"
					description="Once an admin publishes a workflow, it'll appear here for the whole team to read."
				/>
			)}

			{!listQuery.isLoading && publishedRows.length > 0 && filtered.length === 0 && (
				<EmptyState
					title="No matches"
					description={`Nothing matches "${search}". Try a different term, or clear the search.`}
				/>
			)}

			{filtered.length > 0 && (
				<ul className="flex flex-col gap-1">
					{filtered.map((w) => (
						<li key={w.id}>
							<a
								href={`/${organizationSlug}/library/workflows/${w.id}/read`}
								className={cn(
									"flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors",
									"border border-transparent hover:border-border hover:bg-muted/40",
								)}
							>
								<BookOpen className="size-4 text-foreground/40 shrink-0" aria-hidden="true" />
								<div className="flex-1 min-w-0 flex flex-col gap-0.5">
									<div className="flex items-center gap-2 min-w-0">
										<span className="text-sm font-medium truncate">{w.title}</span>
										<TypeChip type={w.type} />
										{w.latestPublishedVersionNumber !== null && (
											<span className="text-[10px] uppercase tracking-wide text-foreground/50 font-mono">
												v{w.latestPublishedVersionNumber}
											</span>
										)}
										{w.aiAuthored && (
											<Sparkles
												className="size-3 text-violet-600 dark:text-violet-400 shrink-0"
												aria-label="AI-authored"
											/>
										)}
									</div>
									{w.description && (
										<span className="text-xs text-foreground/60 truncate">
											{w.description}
										</span>
									)}
								</div>
								<ChevronRight className="size-4 text-foreground/30 shrink-0" aria-hidden="true" />
							</a>
						</li>
					))}
				</ul>
			)}

			{!listQuery.isLoading && publishedRows.length > 0 && (
				<footer className="pt-2 text-[10px] uppercase tracking-wide text-foreground/40">
					{filtered.length} of {publishedRows.length}{" "}
					{publishedRows.length === 1 ? "SOP" : "SOPs"}
				</footer>
			)}
		</article>
	);
}

function TypeChip({
	type,
}: {
	type: "procedure" | "document" | "policy" | "form";
}) {
	const label: Record<typeof type, string> = {
		procedure: "Procedure",
		document: "Document",
		policy: "Policy",
		form: "Form",
	};
	const colorClass: Record<typeof type, string> = {
		procedure: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300",
		document: "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-300",
		policy: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300",
		form: "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-300",
	};
	return (
		<span
			className={cn(
				"px-1.5 py-0.5 text-[9px] uppercase tracking-wide font-medium rounded shrink-0",
				colorClass[type],
			)}
		>
			{label[type]}
		</span>
	);
}

function EmptyState({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<div className="mx-auto max-w-md px-5 py-12 text-center flex flex-col items-center gap-2">
			<BookOpen className="size-8 text-foreground/30" />
			<h2 className="text-base font-medium">{title}</h2>
			<p className="text-sm text-foreground/60">{description}</p>
		</div>
	);
}

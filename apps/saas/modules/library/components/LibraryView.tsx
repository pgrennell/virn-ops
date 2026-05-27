"use client";

// Top-level Library client. Replaces the placeholder. Owns:
//
//   - Tabs over LIBRARY_TYPE_TABS (single source per integrity #3)
//   - Row list from workflows.list (no pagination knob in Pass 1; limit=100 default)
//   - + Create menu (admin only) -- iterates LIBRARY_CREATE_MENU, same source as tabs
//   - Per-row action via the resolver (resolveLibraryRowAction)
//   - Loading / empty / error states
//
// Permission honesty (integrity #2): page passes `isAdminOrOwner` + `canRun` from
// the gating snapshot; this component only renders affordances the caller can use.
// No buttons that bounce off the server.
//
// Pass 1 deliberately does NOT ship:
//   - search / sort (Pass 2)
//   - folders / tags (Pass 2 -- and folders need a data-model decision first)
//   - active-run count / review-due per row (Pass 2 -- needs list-payload extension)
//   - archive UI (Pass 2 -- payload doesn't surface deletedAt today)
//   - tab capability gating (deferred -- the documents/forms capability keys
//     don't exist in the seed; fail-closed silently would be wrong)

import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { cn } from "@virn/ui";
import { Spinner } from "@virn/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

import {
	filterRowsByTab,
	LIBRARY_TYPE_TABS,
	type LibraryTypeTab,
} from "../lib/library-types";
import { CreateWorkflowMenu } from "./CreateWorkflowMenu";
import { LauncherPanel } from "./LauncherPanel";
import { LibraryEmptyState } from "./LibraryEmptyState";
import { LibraryRow } from "./LibraryRow";

/** Workflow context for the launcher panel -- the pinned versionId is what closes
 * the publish-during-fill-window race (D-018 + Launcher plan integrity #1). */
interface LauncherTarget {
	id: string;
	title: string;
	latestPublishedVersionId: string;
}

interface LibraryViewProps {
	organizationSlug: string;
	isAdminOrOwner: boolean;
	/** From canSee(NAV_AREAS.runs, snapshot) at the page level. Today every preset
	 * role that sees Library also has Runs access (per nav.ts), so this is true for
	 * every reachable caller -- but the resolver takes it as a separate input so the
	 * custom-role layer (ADR-004) doesn't require a matrix-rewrite later. */
	canRun: boolean;
	/** From isEnabled(workflows.agent_steps, snapshot) at the page level (Phase 8
	 * step 3). When false, the LauncherForm only offers "human" mode (no mode
	 * selector). Lifted via the agent_steps capability per the 2026-05-26 pivot. */
	agentStepsEnabled: boolean;
}

export function LibraryView({
	organizationSlug,
	isAdminOrOwner,
	canRun,
	agentStepsEnabled,
}: LibraryViewProps) {
	const [activeTabId, setActiveTabId] = useState<LibraryTypeTab["id"]>("all");
	const [topLevelError, setTopLevelError] = useState<string | null>(null);
	const [launcherTarget, setLauncherTarget] = useState<LauncherTarget | null>(null);

	// limit=100 covers a comfortable org-shape for Pass 1; pagination is a Pass-2+
	// optimization. The list query is org-scoped server-side; safe to call.
	const listQuery = useQuery(orpc.workflows.list.queryOptions({ input: {} }));

	const filteredRows = useMemo(() => {
		if (!listQuery.data) return [];
		return filterRowsByTab(listQuery.data, activeTabId);
	}, [listQuery.data, activeTabId]);

	const perms = useMemo(() => ({ isAdminOrOwner, canRun }), [isAdminOrOwner, canRun]);

	if (listQuery.isLoading) {
		return <CenteredSpinner label="Loading library…" />;
	}
	if (listQuery.isError) {
		return (
			<div className="px-5 py-8 text-sm text-destructive">
				Couldn't load the library: {listQuery.error?.message ?? "unknown error"}
			</div>
		);
	}

	const totalRows = listQuery.data?.length ?? 0;

	return (
		<div className="rounded-lg border border-border bg-background overflow-hidden flex h-full min-h-0">
			<div className="flex-1 min-w-0 flex flex-col">
				<header className="px-4 py-3 border-b border-border gap-3 flex items-center">
					<div className="flex-1 min-w-0">
						<h1 className="font-medium text-sm">Library</h1>
						<p className="text-xs text-foreground/60 mt-0.5">
							Workflows, SOPs, policies, and forms — one store, filtered by type.
						</p>
					</div>
					{isAdminOrOwner && (
						<CreateWorkflowMenu
							organizationSlug={organizationSlug}
							onError={setTopLevelError}
						/>
					)}
				</header>

				{topLevelError && (
					<div className="px-4 py-2">
						<Alert variant="error">
							<AlertDescription className="text-xs">{topLevelError}</AlertDescription>
						</Alert>
					</div>
				)}

				{totalRows === 0 ? (
					<LibraryEmptyState
						isAdminOrOwner={isAdminOrOwner}
						organizationSlug={organizationSlug}
						onError={setTopLevelError}
					/>
				) : (
					<>
						<nav
							className="px-4 border-b border-border gap-1 flex items-center overflow-x-auto"
							aria-label="Library type tabs"
						>
							{LIBRARY_TYPE_TABS.map((tab) => {
								const count =
									tab.includes === null
										? totalRows
										: filterRowsByTab(listQuery.data ?? [], tab.id).length;
								return (
									<button
										key={tab.id}
										type="button"
										onClick={() => setActiveTabId(tab.id)}
										aria-current={tab.id === activeTabId ? "page" : undefined}
										className={cn(
											"px-3 py-2 text-sm border-b-2 -mb-px transition-colors",
											tab.id === activeTabId
												? "border-primary text-foreground font-medium"
												: "border-transparent text-foreground/60 hover:text-foreground",
										)}
									>
										{tab.label}{" "}
										<span className="text-[11px] text-foreground/40">({count})</span>
									</button>
								);
							})}
						</nav>

						<div className="flex-1 min-h-0 overflow-y-auto">
							{filteredRows.length === 0 ? (
								<div className="px-5 py-10 text-sm text-foreground/60 text-center">
									No items in this view.
								</div>
							) : (
								<ul>
									{filteredRows.map((row) => (
										<LibraryRow
											key={row.id}
											row={row}
											perms={perms}
											organizationSlug={organizationSlug}
											onError={setTopLevelError}
											onOpenLauncher={setLauncherTarget}
										/>
									))}
								</ul>
							)}
						</div>
					</>
				)}
			</div>

			<LauncherPanel
				open={launcherTarget !== null}
				workflow={launcherTarget}
				organizationSlug={organizationSlug}
				agentStepsEnabled={agentStepsEnabled}
				onClose={() => setLauncherTarget(null)}
			/>
		</div>
	);
}

function CenteredSpinner({ label }: { label: string }) {
	return (
		<div className="flex items-center justify-center gap-3 py-24 text-foreground/60">
			<Spinner className="size-4" /> {label}
		</div>
	);
}

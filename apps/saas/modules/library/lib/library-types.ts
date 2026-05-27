// apps/saas/modules/library/lib/library-types.ts
//
// Single source of truth for the Library type-tab ↔ workflow.type mapping. The tab
// filter, the + Create menu, the row's type-colored icon, the row's "Create your first
// ..." empty-state CTA — all read from this table. Don't scatter the mapping; if a tab
// or a workflow type ever changes (UX_SPEC §4.2 reserves grid view + saved views), the
// edit lives in exactly one place.

import type { WorkflowListRow } from "@library/lib/library-row-action";

export type WorkflowType = WorkflowListRow["type"]; // "procedure" | "document" | "policy" | "form"

export interface LibraryTypeTab {
	/** URL-safe tab id (also used in tests / cypress selectors). */
	id: "all" | "workflows" | "sops" | "forms";
	/** Display label on the tab. */
	label: string;
	/** The workflow.type values this tab includes. null = the "All" tab (no filter). */
	includes: readonly WorkflowType[] | null;
	/**
	 * The type used when this tab is the create target. null on "All" (Create menu
	 * iterates the create-target tabs, not All). Each create-target tab maps to
	 * exactly one type — so creating from the SOPs tab makes a "document" row by
	 * default (the Create menu lets the user pick document vs. policy specifically).
	 */
	createDefaultType: WorkflowType | null;
	/** Display label on the Create menu item ("New workflow" etc.). */
	createLabel: string;
}

/** The five entries in the Create menu mirror the four workflow.type values; "SOPs"
 * splits into Document + Policy at create time (per UX_SPEC §4.2: "+ Create menu:
 * Workflow / SOP or Policy / Form / Import from template"). The TABS however collapse
 * document + policy into one SOPs tab — three independent constants below model both. */
export const LIBRARY_TYPE_TABS: readonly LibraryTypeTab[] = [
	{
		id: "all",
		label: "All",
		includes: null,
		createDefaultType: null,
		createLabel: "",
	},
	{
		id: "workflows",
		label: "Workflows",
		includes: ["procedure"],
		createDefaultType: "procedure",
		createLabel: "New workflow",
	},
	{
		id: "sops",
		label: "SOPs",
		includes: ["document", "policy"],
		createDefaultType: "document",
		createLabel: "New SOP",
	},
	{
		id: "forms",
		label: "Forms",
		includes: ["form"],
		createDefaultType: "form",
		createLabel: "New form",
	},
] as const;

/** The four create-menu entries (procedure / document / policy / form), in stable
 * display order. SOPs splits into "SOP" (document) + "Policy" (policy) here because
 * the Create menu lets the user pick the specific type. Anything iterating this list
 * to build the menu MUST stay in lockstep with the workflow.type enum -- the test
 * pins this. */
export interface LibraryCreateMenuEntry {
	type: WorkflowType;
	label: string;
}

export const LIBRARY_CREATE_MENU: readonly LibraryCreateMenuEntry[] = [
	{ type: "procedure", label: "New workflow" },
	{ type: "document", label: "New SOP" },
	{ type: "policy", label: "New policy" },
	{ type: "form", label: "New form" },
] as const;

/** Per-type rendering metadata (icon + accent color hint). Centralized so the row +
 * the empty state + the Create menu all show the same chip. */
export interface LibraryTypeChip {
	label: string;
	className: string;
}

export const LIBRARY_TYPE_CHIPS: Record<WorkflowType, LibraryTypeChip> = {
	procedure: {
		label: "Workflow",
		className: "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-300",
	},
	document: {
		label: "SOP",
		className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300",
	},
	policy: {
		label: "Policy",
		className: "bg-purple-100 text-purple-900 dark:bg-purple-900/30 dark:text-purple-300",
	},
	form: {
		label: "Form",
		className: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300",
	},
};

/** Filter a row list by tab id. "All" returns the input unchanged. */
export function filterRowsByTab<T extends { type: WorkflowType }>(
	rows: readonly T[],
	tabId: LibraryTypeTab["id"],
): T[] {
	const tab = LIBRARY_TYPE_TABS.find((t) => t.id === tabId);
	if (!tab || tab.includes === null) return [...rows];
	const allowed = new Set(tab.includes);
	return rows.filter((r) => allowed.has(r.type));
}

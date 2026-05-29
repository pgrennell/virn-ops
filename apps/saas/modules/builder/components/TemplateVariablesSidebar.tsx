"use client";

// Phase 9.5 R4 lift -- Template Variables sidebar component (PRD_WORKFLOW_SOP_BUILDER.md
// §6.2). A flat token list rendered in the bottom-left of the Workflow Builder Author
// view shell. Source is the EntityAdapter registry's schemaForAI() output, fetched via
// the `entities.listSchemasForAI` oRPC procedure -- the SAME catalog feeds the Phase 12
// AI authoring system prompt, so tokens the operator sees here match references the AI
// will emit.
//
// What this component is and is not:
//   - IS: a self-contained, presentational + data-fetching component. Renders search
//     input + scrollable token list. Token rows support click-to-copy of the
//     `{{ entity.field }}` mustache form via the Clipboard API (drag-drop into Tiptap
//     editors is deferred to a follow-on session that wires this sidebar into specific
//     editor instances -- requires per-editor integration that's risky without
//     browser-verify).
//   - IS NOT: yet integrated into BuilderView's layout. This component is exported and
//     ready to drop in (see the section comment in BuilderView for the intended slot --
//     bottom-left of the Author shell). Wiring is a follow-on so the rendering can be
//     spot-checked in isolation first.
//
// Token shape: `{{ <entity_type>.<field_key> }}`. The entity_type is the schema key
// (in v1.5 only `listing`); field_key matches the snake_case `key` from
// schemaForAI().fields.
//
// Design notes:
//   - Static tokens only. R4 explicitly NOT live PMS hydration (per PRD §5 non-goals);
//     the rename-safety story stays with D-017 field-key lifecycle locks. Live values
//     are a Phase 17+ vendor-integration concern.
//   - Field-key locked styling: tokens render with a monospace font + chip background.
//     When drag-drop integration ships (follow-on), these chips drop into Tiptap as
//     locked merge-token nodes that honor D-017's "clear references first" lifecycle.
//   - Per D-039, this sidebar lives in the existing step-list builder shell. There is
//     no canvas authoring surface; the sidebar slot is below the StepList region.
//
// Visible reference: docs/besty-ux-reference/storylane-step-16.png

import { Input } from "@virn/ui/components/input";
import { Spinner } from "@virn/ui/components/spinner";
import { cn } from "@virn/ui";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

// ---------------------------------------------------------------------------
// Token shape
// ---------------------------------------------------------------------------

interface TemplateToken {
	/** The mustache form: `{{ listing.name }}`. This is what gets copied or dragged
	 * into Tiptap editors. */
	mustache: string;
	/** The entity type key (`listing`, eventually `vendor`, `building`, etc.). */
	entityType: string;
	/** Human-readable entity label (`Listing`, etc.). */
	entityLabel: string;
	/** The field key (snake_case, matches schemaForAI().fields[i].key). */
	fieldKey: string;
	/** Human-readable field label (`Name`, `Property type`, etc.). */
	fieldLabel: string;
	/** Field data-type hint surfaced in the chip tooltip. */
	dataType: "text" | "number" | "boolean" | "date" | "json";
	/** Whether the field can be null in the schema -- shown as a small "?" badge on the
	 * token chip so the operator knows the merged value may be empty. */
	nullable: boolean;
	/** Optional field-level description from the adapter's schemaForAI(). Shown in the
	 * row's hover tooltip; helps the operator pick the right token without leaving the
	 * builder. */
	description?: string;
}

function buildTokensFromSchemas(
	schemas: ReadonlyArray<{
		type: string;
		label: string;
		fields: ReadonlyArray<{
			key: string;
			label: string;
			dataType: "text" | "number" | "boolean" | "date" | "json";
			nullable: boolean;
			description?: string;
		}>;
	}>,
): TemplateToken[] {
	const out: TemplateToken[] = [];
	for (const schema of schemas) {
		for (const field of schema.fields) {
			out.push({
				mustache: `{{ ${schema.type}.${field.key} }}`,
				entityType: schema.type,
				entityLabel: schema.label,
				fieldKey: field.key,
				fieldLabel: field.label,
				dataType: field.dataType,
				nullable: field.nullable,
				description: field.description,
			});
		}
	}
	return out;
}

function fuzzyMatch(token: TemplateToken, query: string): boolean {
	if (!query) return true;
	const haystack = [
		token.entityType,
		token.entityLabel,
		token.fieldKey,
		token.fieldLabel,
		token.description ?? "",
	]
		.join(" ")
		.toLowerCase();
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	// Simple substring match for v1; a fuzzy-score upgrade is cheap if the user
	// catalog grows large (post-v1 Layer-1 ships many entity types).
	return haystack.includes(needle);
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export interface TemplateVariablesSidebarProps {
	/** Optional class name to layer on the outer container (lets the parent control
	 * width / height / position within the builder shell). */
	className?: string;
	/** Optional handler called when a token is clicked, AFTER the clipboard copy. The
	 * parent can use this for analytics or to surface a custom toast; defaults to the
	 * built-in "copied" indicator on the row. Pass `null` to disable click-to-copy
	 * entirely (e.g. when wiring drag-drop into Tiptap as the primary path -- the
	 * follow-on integration). */
	onTokenClick?: ((token: TemplateToken) => void) | null;
}

export function TemplateVariablesSidebar({
	className,
	onTokenClick,
}: TemplateVariablesSidebarProps) {
	const schemasQuery = useQuery(
		orpc.entities.listSchemasForAI.queryOptions({ input: {} }),
	);

	const [search, setSearch] = useState("");
	const [copiedMustache, setCopiedMustache] = useState<string | null>(null);

	const tokens = useMemo(() => {
		if (!schemasQuery.data) return [];
		return buildTokensFromSchemas(schemasQuery.data.schemas);
	}, [schemasQuery.data]);

	const filteredTokens = useMemo(
		() => tokens.filter((t) => fuzzyMatch(t, search)),
		[tokens, search],
	);

	const handleTokenClick = (token: TemplateToken) => {
		if (onTokenClick === null) return; // Click-to-copy disabled.

		// Defer to the parent if provided; the parent may do its own clipboard
		// handling or rendering of a toast.
		if (onTokenClick) {
			onTokenClick(token);
			return;
		}

		// Default click handler: copy the mustache form to the clipboard and surface
		// a transient "copied" indicator on this row. Defensive against environments
		// without a Clipboard API (e.g. non-secure context) -- a copy failure is
		// silent (the row still flips to copied state since the indicator is purely
		// UI feedback; the user can retry).
		void navigator.clipboard?.writeText(token.mustache).catch(() => {
			// noop -- the indicator below still lights up; user can paste via
			// browser-native context menu fallback if clipboard write was denied.
		});
		setCopiedMustache(token.mustache);
		// Reset after ~1.5s so the indicator doesn't stick.
		window.setTimeout(() => {
			setCopiedMustache((current) =>
				current === token.mustache ? null : current,
			);
		}, 1500);
	};

	return (
		<aside
			className={cn(
				"flex flex-col bg-background border border-border rounded-lg overflow-hidden",
				className,
			)}
			aria-label="Template variables"
		>
			<header className="px-3 py-2 border-b border-border">
				<h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
					Template variables
				</h3>
				<p className="mt-0.5 text-[10px] text-muted-foreground/80">
					Click any token to copy. Use in step descriptions, field labels, and
					notification templates.
				</p>
			</header>

			<div className="px-3 py-2 border-b border-border">
				<div className="relative">
					<Search
						className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground"
						aria-hidden="true"
					/>
					<Input
						type="search"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search tokens…"
						className="h-7 pl-7 text-xs"
						aria-label="Search template variables"
					/>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto px-2 py-2">
				{schemasQuery.isLoading && (
					<div className="flex items-center justify-center py-6">
						<Spinner className="size-4 text-muted-foreground" />
					</div>
				)}

				{schemasQuery.error && !schemasQuery.isLoading && (
					<p className="px-2 py-3 text-xs text-destructive">
						Couldn't load template variables.
					</p>
				)}

				{!schemasQuery.isLoading &&
					!schemasQuery.error &&
					filteredTokens.length === 0 && (
						<p className="px-2 py-3 text-xs text-muted-foreground">
							{tokens.length === 0
								? "No template variables available yet."
								: `No tokens match "${search.trim()}".`}
						</p>
					)}

				{!schemasQuery.isLoading && filteredTokens.length > 0 && (
					<ul className="flex flex-col gap-px">
						{filteredTokens.map((token) => (
							<TokenRow
								key={token.mustache}
								token={token}
								copied={copiedMustache === token.mustache}
								interactive={onTokenClick !== null}
								onClick={() => handleTokenClick(token)}
							/>
						))}
					</ul>
				)}
			</div>

			<footer className="px-3 py-1.5 border-t border-border text-[10px] text-muted-foreground/80">
				{tokens.length} token{tokens.length === 1 ? "" : "s"} ·{" "}
				{schemasQuery.data?.schemas.length ?? 0} entity type
				{(schemasQuery.data?.schemas.length ?? 0) === 1 ? "" : "s"}
			</footer>
		</aside>
	);
}

// ---------------------------------------------------------------------------
// Token row -- internal subcomponent
// ---------------------------------------------------------------------------

function TokenRow({
	token,
	copied,
	interactive,
	onClick,
}: {
	token: TemplateToken;
	copied: boolean;
	interactive: boolean;
	onClick: () => void;
}) {
	const tooltipParts = [
		`${token.entityLabel} · ${token.fieldLabel}`,
		`type: ${token.dataType}${token.nullable ? " (nullable)" : ""}`,
		token.description,
	].filter(Boolean);

	const body = (
		<>
			<span className="flex-1 min-w-0 flex flex-col gap-0.5">
				<span className="font-mono text-[11px] truncate text-foreground">
					{token.mustache}
				</span>
				<span className="text-[10px] text-muted-foreground/80 truncate">
					{token.entityLabel} · {token.fieldLabel}
					{token.nullable && (
						<span className="ml-1 opacity-60" title="May be null at run time">
							?
						</span>
					)}
				</span>
			</span>
			{interactive && (
				<span
					className="shrink-0 size-5 flex items-center justify-center text-muted-foreground/60 group-hover:text-foreground"
					aria-hidden="true"
				>
					{copied ? (
						<Check className="size-3.5 text-emerald-600" />
					) : (
						<Copy className="size-3.5" />
					)}
				</span>
			)}
		</>
	);

	if (!interactive) {
		return (
			<li
				className="group flex items-center gap-2 px-2 py-1.5 rounded text-xs"
				title={tooltipParts.join(" — ")}
			>
				{body}
			</li>
		);
	}

	return (
		<li>
			<button
				type="button"
				onClick={onClick}
				className={cn(
					"group w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs",
					"hover:bg-muted/60 active:bg-muted",
					"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
				)}
				title={tooltipParts.join(" — ")}
				aria-label={`Copy template variable ${token.mustache}`}
			>
				{body}
			</button>
		</li>
	);
}

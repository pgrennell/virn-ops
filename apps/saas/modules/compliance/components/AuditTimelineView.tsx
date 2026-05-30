"use client";

// Phase 15 -- audit timeline renderer (S-10). Used by both the per-workflow
// Audit tab (Slice C) and the per-acknowledgment evidence receipt (Slice D).
//
// Polymorphic over (entityType, entityId) -- caller passes the entity, this
// view renders the timeline. URL state (page) lives in nuqs so refresh-stable
// pagination Just Works on either surface.
//
// Row shape: action verb + actor identity + relative timestamp + (when present)
// a key/value diff summary derived from the `changes` JSON. The compliance
// reader is intentionally read-only -- there are no row actions; the value is
// in the verifiable record itself.

import { Pagination } from "@shared/components/Pagination";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Badge } from "@virn/ui/components/badge";
import { Skeleton } from "@virn/ui/components/skeleton";
import { Bot, Globe, User as UserIcon, Users } from "lucide-react";
import { parseAsInteger, useQueryState } from "nuqs";

const ITEMS_PER_PAGE = 25;

// Mirror the API's AuditEntityType union. The procedure validates against the
// same set; keeping it here as a literal lets the UI typecheck props without
// pulling in the database package.
type AuditEntityType =
	| "workflow"
	| "workflow_version"
	| "section"
	| "step"
	| "field"
	| "run"
	| "run_step"
	| "field_value"
	| "suggestion"
	| "automation_rule"
	| "version_approval"
	| "acknowledgment"
	| "template_listing"
	| "template_listing_version"
	| "solution_pack"
	| "pack_version"
	| "field_definition"
	| "role"
	| "agent"
	| "vendor"
	| "vendor_contact"
	| "listing"
	| "outbound_webhook_credential"
	| "playbook"
	| "playbook_version"
	| "playbook_run"
	| "playbook_run_step";

interface AuditTimelineViewProps {
	entityType: AuditEntityType;
	entityId: string;
	/** Pre-rendered initial page index (from server's searchParams hydration). */
	initialPage: number;
	/** Header copy. The caller knows what entity this is for -- compose the
	 * surrounding chrome with the right context. */
	emptyStateLabel?: string;
}

export function AuditTimelineView({
	entityType,
	entityId,
	initialPage,
	emptyStateLabel,
}: AuditTimelineViewProps) {
	const [page, setPage] = useQueryState(
		"page",
		parseAsInteger.withDefault(initialPage).withOptions({ history: "replace" }),
	);

	const auditQuery = useQuery(
		orpc.audit.listForEntity.queryOptions({
			input: {
				entityType,
				entityId,
				limit: ITEMS_PER_PAGE,
				offset: (page - 1) * ITEMS_PER_PAGE,
			},
		}),
	);

	if (auditQuery.isLoading) {
		return <TimelineSkeleton />;
	}
	if (auditQuery.isError) {
		return (
			<div className="p-4">
				<Alert variant="error">
					<AlertDescription>
						Couldn't load audit log: {auditQuery.error?.message ?? "unknown error"}
					</AlertDescription>
				</Alert>
			</div>
		);
	}
	if (!auditQuery.data || auditQuery.data.rows.length === 0) {
		return (
			<div className="px-5 py-16 text-sm text-foreground/60 text-center">
				{emptyStateLabel ?? "No audit history for this entity yet."}
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full min-h-0">
			<div className="flex-1 min-h-0 overflow-y-auto">
				<ol className="divide-y divide-border">
					{auditQuery.data.rows.map((row) => (
						<AuditRow key={row.id} row={row} />
					))}
				</ol>
			</div>
			{auditQuery.data.totalCount > ITEMS_PER_PAGE && (
				<div className="border-t border-border py-3">
					<Pagination
						currentPage={page}
						totalItems={auditQuery.data.totalCount}
						itemsPerPage={ITEMS_PER_PAGE}
						onChangeCurrentPage={(p) => void setPage(p)}
					/>
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface AuditRowData {
	id: string;
	action: string;
	actorKind: "user" | "guest" | "agent" | "vendor";
	actorUserName: string | null;
	actorUserEmail: string | null;
	actorParticipantId: string | null;
	crossProductOrigin: string | null;
	changes: Record<string, unknown> | null;
	createdAt: Date | string;
}

function AuditRow({ row }: { row: AuditRowData }) {
	const date = typeof row.createdAt === "string" ? new Date(row.createdAt) : row.createdAt;
	return (
		<li className="px-4 py-3 gap-3 flex items-start">
			<ActorIcon kind={row.actorKind} />
			<div className="flex-1 min-w-0">
				<div className="flex items-baseline gap-2 flex-wrap">
					<span className="font-medium text-sm">
						{formatActor(row)}
					</span>
					<span className="text-xs text-foreground/60">{formatAction(row.action)}</span>
					{row.crossProductOrigin && (
						<Badge status="info" className="!px-2 !py-0.5 !text-[10px] !normal-case">
							via {row.crossProductOrigin}
						</Badge>
					)}
				</div>
				{row.changes && Object.keys(row.changes).length > 0 && (
					<ChangesSummary changes={row.changes} />
				)}
				<div className="text-[11px] text-foreground/50 mt-1 tabular-nums">
					{formatDateTime(date)}
				</div>
			</div>
		</li>
	);
}

function ActorIcon({ kind }: { kind: AuditRowData["actorKind"] }) {
	const icon = (() => {
		switch (kind) {
			case "user":
				return <UserIcon className="size-3.5" />;
			case "guest":
				return <Users className="size-3.5" />;
			case "agent":
				return <Bot className="size-3.5" />;
			case "vendor":
				return <Globe className="size-3.5" />;
		}
	})();
	return (
		<div className="size-7 rounded-full bg-muted/50 flex items-center justify-center text-foreground/60 shrink-0">
			{icon}
		</div>
	);
}

function formatActor(row: AuditRowData): string {
	if (row.actorKind === "user") {
		return row.actorUserName ?? row.actorUserEmail ?? "Unknown user";
	}
	if (row.actorKind === "guest") {
		return row.actorParticipantId
			? `Guest (participant ${row.actorParticipantId.slice(0, 8)}…)`
			: "Guest";
	}
	if (row.actorKind === "agent") {
		return row.actorParticipantId
			? `Agent (participant ${row.actorParticipantId.slice(0, 8)}…)`
			: "Agent";
	}
	if (row.actorKind === "vendor") {
		return row.actorParticipantId
			? `Vendor (participant ${row.actorParticipantId.slice(0, 8)}…)`
			: "Vendor";
	}
	return "Unknown";
}

function formatAction(action: string): string {
	// audit actions ship as dot-namespaced verbs ("workflow.published",
	// "approval.decided"). Hyphenate for display so the eye groups the noun +
	// verb naturally: "workflow · published".
	return action.replaceAll(".", " · ");
}

function ChangesSummary({ changes }: { changes: Record<string, unknown> }) {
	// Render up to 4 key/value pairs. Anything deeper than one level renders
	// as `<json>`; full payloads are out of scope for a reader UI (forensics
	// belongs in the DB query). For from/to diffs (common shape:
	// `{ field: { from, to } }`), render as "field: X → Y".
	const entries = Object.entries(changes).slice(0, 4);
	return (
		<ul className="text-xs text-foreground/70 mt-1 gap-0.5 flex flex-col">
			{entries.map(([key, value]) => (
				<li key={key} className="font-mono">
					<span className="text-foreground/50">{key}:</span>{" "}
					{formatChangeValue(value)}
				</li>
			))}
			{Object.keys(changes).length > 4 && (
				<li className="text-foreground/50 italic">
					+{Object.keys(changes).length - 4} more
				</li>
			)}
		</ul>
	);
}

function formatChangeValue(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "object" && "from" in value && "to" in value) {
		return `${formatScalar((value as { from: unknown }).from)} → ${formatScalar((value as { to: unknown }).to)}`;
	}
	return formatScalar(value);
}

function formatScalar(v: unknown): string {
	if (v === null || v === undefined) return "—";
	if (typeof v === "string") return v.length > 40 ? `"${v.slice(0, 40)}…"` : `"${v}"`;
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	return "<json>";
}

function formatDateTime(d: Date): string {
	return d.toLocaleString();
}

function TimelineSkeleton() {
	return (
		<div className="px-4 py-3 gap-3 flex flex-col">
			{[0, 1, 2, 3, 4, 5].map((i) => (
				<div key={i} className="gap-3 flex items-start">
					<Skeleton className="size-7 rounded-full" />
					<div className="flex-1 gap-2 flex flex-col">
						<Skeleton className="h-4 w-1/2" />
						<Skeleton className="h-3 w-1/3" />
					</div>
				</div>
			))}
		</div>
	);
}

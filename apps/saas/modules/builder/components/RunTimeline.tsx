"use client";

// Phase 10 / v1.5c (PRD §6.4 / R5 cont.) -- per-run timeline rendered in the
// Read view's right column when opened with `?runId=<id>`.
//
// Static text. No animation, no "real-time colored flowchart execution
// overlay" -- that v2.0 PRD framing was rejected per the screenshot-honest
// review (BUILD_PLAN.md Phase 10 R5 cont.: "Besty reference shows static
// diagram + text timeline, not animation").
//
// Layout: vertical bullet-point list. Each row is one activity_event:
//   - left rail: time chip (HH:mm) and a small dot
//   - body: actor name + verb-derived sentence + optional step/title hint
//   - day breaks: render as a thin divider with the date when consecutive
//     events span more than one calendar day
//
// The activity stream is pack-extensible (verbs are free text), so we map
// well-known verbs to friendlier sentences and fall back to the raw verb
// for unknown ones rather than guessing.

import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Spinner } from "@virn/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { Activity, BookOpen } from "lucide-react";

import { orpc } from "@shared/lib/orpc-query-utils";

interface RunTimelineProps {
	runId: string;
}

export function RunTimeline({ runId }: RunTimelineProps) {
	const query = useQuery(orpc.runs.listActivity.queryOptions({ input: { runId } }));

	if (query.isLoading) {
		return (
			<div className="h-full w-full flex items-center justify-center gap-2 text-xs text-foreground/60">
				<Spinner className="size-4" /> Loading timeline…
			</div>
		);
	}

	if (query.isError) {
		return (
			<Alert variant="error" className="m-3">
				<AlertDescription className="text-xs">
					{query.error instanceof Error
						? query.error.message
						: "Couldn't load the run timeline."}
				</AlertDescription>
			</Alert>
		);
	}

	const events = query.data?.events ?? [];
	if (events.length === 0) {
		return (
			<div className="h-full w-full flex flex-col items-center justify-center gap-2 text-center px-6 text-xs text-foreground/50">
				<BookOpen className="size-6 text-foreground/30" aria-hidden="true" />
				<span>No activity recorded yet on this run.</span>
			</div>
		);
	}

	return (
		<div className="h-full w-full overflow-y-auto rounded-lg border border-border bg-muted/10">
			<header className="px-3 py-2 border-b border-border bg-background flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-foreground/60">
				<Activity className="size-3.5" aria-hidden="true" />
				Run timeline
			</header>
			<ol className="flex flex-col">
				{events.map((event, idx) => {
					const prior = idx > 0 ? events[idx - 1] : null;
					const showDayBreak = prior === null || !sameDay(prior.createdAt, event.createdAt);
					return (
						<li key={event.id} className="flex flex-col">
							{showDayBreak && <DayDivider date={event.createdAt} />}
							<TimelineRow event={event} />
						</li>
					);
				})}
			</ol>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Row + day divider
// ---------------------------------------------------------------------------

type TimelineEvent = {
	id: string;
	verb: string;
	actorKind: "user" | "guest" | "agent" | "vendor";
	actorUserId: string | null;
	actorUserName: string | null;
	actorParticipantId: string | null;
	crossProductOrigin: string | null;
	data: Record<string, unknown> | null;
	createdAt: Date | string;
};

function TimelineRow({ event }: { event: TimelineEvent }) {
	const ts = toDate(event.createdAt);
	const time = ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	const sentence = renderSentence(event);
	return (
		<div className="grid grid-cols-[3rem_1fr] gap-2 px-3 py-2 border-b border-border/40 last:border-b-0">
			<time
				dateTime={ts.toISOString()}
				className="text-[10px] font-mono uppercase tracking-wider text-foreground/50 pt-0.5"
			>
				{time}
			</time>
			<div className="flex flex-col gap-0.5 min-w-0">
				<div className="text-xs text-foreground/80 leading-snug">{sentence}</div>
				{event.crossProductOrigin && (
					<div className="text-[10px] text-foreground/40">
						via {event.crossProductOrigin}
					</div>
				)}
			</div>
		</div>
	);
}

function DayDivider({ date }: { date: Date | string }) {
	const d = toDate(date);
	const label = d.toLocaleDateString(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
	});
	return (
		<div className="px-3 py-1 border-b border-border/40 bg-muted/30 text-[10px] uppercase tracking-wider font-semibold text-foreground/50">
			{label}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Verb -> sentence mapping. Exported for unit testing.
// ---------------------------------------------------------------------------

export function renderSentence(event: TimelineEvent): string {
	const actor = renderActor(event);
	const subject = extractSubject(event.data);

	// Well-known verbs first; fall back to raw verb at the bottom so pack-defined
	// verbs render readably without bespoke mappings.
	switch (event.verb) {
		case "launched":
			return `${actor} launched the run.`;
		case "completed_step":
			return subject
				? `${actor} completed step "${subject}".`
				: `${actor} completed a step.`;
		case "set_field_value":
			return subject
				? `${actor} updated "${subject}".`
				: `${actor} updated a field.`;
		case "commented":
			return `${actor} commented.`;
		case "skipped_step":
			return subject
				? `${actor} skipped step "${subject}".`
				: `${actor} skipped a step.`;
		case "marked_not_applicable":
			return subject
				? `${actor} marked "${subject}" not applicable.`
				: `${actor} marked a step not applicable.`;
		case "assigned":
			return subject
				? `${actor} assigned "${subject}".`
				: `${actor} made an assignment.`;
		default:
			return subject
				? `${actor} ${event.verb} ${subject ? `"${subject}"` : ""}.`
				: `${actor} ${event.verb}.`;
	}
}

function renderActor(event: TimelineEvent): string {
	if (event.actorUserName && event.actorUserName.trim().length > 0) {
		return event.actorUserName;
	}
	switch (event.actorKind) {
		case "agent":
			return "An agent";
		case "guest":
			return "A guest";
		case "vendor":
			return "A vendor";
		default:
			return "A teammate";
	}
}

function extractSubject(data: Record<string, unknown> | null): string | null {
	if (!data) return null;
	const candidates: Array<keyof typeof data> = ["stepTitle", "fieldLabel", "title", "label"];
	for (const key of candidates) {
		const value = data[key];
		if (typeof value === "string" && value.trim().length > 0) return value;
	}
	return null;
}

function toDate(value: Date | string): Date {
	return value instanceof Date ? value : new Date(value);
}

function sameDay(a: Date | string, b: Date | string): boolean {
	const da = toDate(a);
	const db = toDate(b);
	return (
		da.getFullYear() === db.getFullYear() &&
		da.getMonth() === db.getMonth() &&
		da.getDate() === db.getDate()
	);
}

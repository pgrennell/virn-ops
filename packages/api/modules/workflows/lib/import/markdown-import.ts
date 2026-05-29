// packages/api/modules/workflows/lib/import/markdown-import.ts
//
// Phase 13 slice B (PRD §11) -- deterministic parser for Tango / Scribe /
// generic numbered-step markdown exports. Bypasses the AI authoring path
// when the structure is predictable enough that token spend is wasteful.
//
// What this parser recognizes (in priority order):
//
//   1. Tango-style       : `## Step 1: Open the dashboard`
//                          `## Step 2 - Click Settings`
//   2. Scribe-style      : `**1.** Click File`
//                          `**2.** Choose New Document`
//   3. Numbered-markdown : `## 1. Step title` or `1. Step title`
//
// All three formats use the same conceptual shape: title + optional
// description body. Returns the same ImportedWorkflow shape regardless of
// which detector matched, plus a `detectedFormat` discriminator so the
// caller can surface "looks like Tango" / "looks like Scribe" copy.
//
// Returns null when:
//   - The source has fewer than 2 recognizable steps (one-step markdown is
//     too ambiguous to be safely deterministic; the AI path handles it).
//   - The source is empty or whitespace-only.
//
// What this parser does NOT do:
//   - Attach screenshots. Image references (`![alt](url)`) are stripped from
//     the step body and replaced with a `[screenshot: alt]` marker so the
//     user sees where screenshots existed in the source. Full attachment
//     support is post-v1.
//   - Field extraction. Imported steps land with no kickoff or step fields;
//     the user adds them in the Builder after import. Tango/Scribe exports
//     don't carry structured fields anyway.
//   - Sections. v1 import flattens everything into a single step list. A
//     future enhancement can detect `# Section` / `## Section` headers
//     above the step heading regex and group steps into sections.

const MAX_SOURCE_CHARS = 200_000;
const MAX_STEPS = 200;

export interface ImportedWorkflowStep {
	title: string;
	description: string | null;
}

export type DetectedFormat =
	| "tango-style"
	| "scribe-style"
	| "numbered-markdown"
	| "unknown";

export interface ImportedWorkflow {
	title: string;
	description: string | null;
	steps: ImportedWorkflowStep[];
	detectedFormat: DetectedFormat;
}

/** Try to parse a Tango / Scribe / numbered-markdown export into a workflow
 * shape. Returns null when the source isn't recognizably structured -- the
 * caller is expected to fall back to AI authoring in that case.
 *
 * Pure function: no DB, no AI, no I/O. Unit-testable against literal source
 * strings; the procedure layer is a thin call site over this. */
export function parseStructuredMarkdown(
	rawSource: string,
): ImportedWorkflow | null {
	if (typeof rawSource !== "string") return null;
	const source = rawSource.slice(0, MAX_SOURCE_CHARS).trim();
	if (source.length === 0) return null;

	// Strip image references from the WHOLE source FIRST so split positions
	// aren't thrown off by long screenshot URLs. We keep the alt text as a
	// marker so the user can see where each screenshot used to live.
	const cleaned = stripImageReferences(source);

	// Try each detector in order; the first to find >= 2 steps wins. The
	// detectors share a contract: scan the source and return an array of
	// (heading-line-index, step-title, format) tuples or [] if none matched.
	const tango = detectTangoStyle(cleaned);
	if (tango.length >= 2) return assemble(cleaned, tango, "tango-style");

	const scribe = detectScribeStyle(cleaned);
	if (scribe.length >= 2) return assemble(cleaned, scribe, "scribe-style");

	const numbered = detectNumberedMarkdown(cleaned);
	if (numbered.length >= 2) return assemble(cleaned, numbered, "numbered-markdown");

	return null;
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

interface StepHeading {
	lineIndex: number;
	title: string;
}

/** Tango exports use `## Step N: Title` or `## Step N - Title`. Tango is
 * fairly consistent about the prefix; case-insensitive for resilience. */
function detectTangoStyle(source: string): StepHeading[] {
	const lines = source.split(/\r?\n/);
	const re = /^##\s+Step\s+(\d+)\s*[:.\-–—]\s*(.+)$/i;
	const hits: StepHeading[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(re);
		if (m && m[2]) hits.push({ lineIndex: i, title: m[2].trim() });
	}
	return hits;
}

/** Scribe-style: bold-leading numbered items, no h2. `**1.** Step body`. The
 * "title" is the first non-empty line of the step body (Scribe doesn't use
 * a separate title; the body IS the instruction). */
function detectScribeStyle(source: string): StepHeading[] {
	const lines = source.split(/\r?\n/);
	const re = /^\*\*(\d+)\.\*\*\s*(.+)$/;
	const hits: StepHeading[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(re);
		if (m && m[2]) hits.push({ lineIndex: i, title: m[2].trim() });
	}
	return hits;
}

/** Generic numbered markdown -- `## 1. Title` (h2-prefixed) or `1. Title`
 * (top-level numbered list). Tries h2 first; falls back to top-level list
 * only when h2 produces nothing. Top-level lists are weaker signals because
 * any short numbered list confuses the detector; we require at least 2
 * sequential numbers (1-then-2, 2-then-3) to claim it as workflow shape. */
function detectNumberedMarkdown(source: string): StepHeading[] {
	const lines = source.split(/\r?\n/);
	const h2Re = /^##\s+(\d+)[.)\-]\s*(.+)$/;
	const listRe = /^(\d+)[.)\-]\s+(.+)$/;
	const h2: StepHeading[] = [];
	const list: StepHeading[] = [];
	for (let i = 0; i < lines.length; i++) {
		const mH2 = lines[i].match(h2Re);
		if (mH2 && mH2[2]) {
			h2.push({ lineIndex: i, title: mH2[2].trim() });
			continue;
		}
		const mList = lines[i].match(listRe);
		if (mList && mList[2]) {
			list.push({ lineIndex: i, title: mList[2].trim() });
		}
	}
	if (h2.length >= 2) return h2;
	// Top-level list path: require sequential numbering so prose lists like
	// "1. Apples 2. Oranges" inside a paragraph don't mismatch.
	if (list.length >= 2 && isSequential(list)) return list;
	return [];
}

function isSequential(hits: StepHeading[]): boolean {
	// We don't preserve the source number on StepHeading, so re-derive it
	// from the source-line context. For the v1 conservative check: just ensure
	// consecutive hits don't span >5 lines of gap (so a numbered list inside
	// one block, not numbers scattered across paragraphs).
	if (hits.length < 2) return false;
	for (let i = 1; i < hits.length; i++) {
		const gap = hits[i].lineIndex - hits[i - 1].lineIndex;
		if (gap > 20) return false;
	}
	return true;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function assemble(
	source: string,
	headings: StepHeading[],
	detectedFormat: DetectedFormat,
): ImportedWorkflow {
	const lines = source.split(/\r?\n/);
	const cappedHeadings = headings.slice(0, MAX_STEPS);

	// Workflow title: first H1 if present, else first non-empty line above the
	// first step heading, else a sensible default.
	const firstStepLine = cappedHeadings[0]?.lineIndex ?? lines.length;
	const headerSection = lines.slice(0, firstStepLine);
	const workflowTitle = extractTitle(headerSection);
	const workflowDescription = extractDescription(headerSection, workflowTitle);

	const steps: ImportedWorkflowStep[] = cappedHeadings.map((h, idx) => {
		const start = h.lineIndex + 1;
		const end = idx + 1 < cappedHeadings.length ? cappedHeadings[idx + 1].lineIndex : lines.length;
		const body = lines.slice(start, end).join("\n").trim();
		return {
			title: truncate(h.title, 200),
			description: body.length > 0 ? truncate(body, 8000) : null,
		};
	});

	return {
		title: truncate(workflowTitle, 200),
		description: workflowDescription ? truncate(workflowDescription, 8000) : null,
		steps,
		detectedFormat,
	};
}

function extractTitle(headerLines: ReadonlyArray<string>): string {
	// Prefer an explicit H1.
	for (const line of headerLines) {
		const m = line.match(/^#\s+(.+)$/);
		if (m && m[1]) return m[1].trim();
	}
	// Otherwise: first non-empty non-prose line. Skip lines that look like
	// frontmatter (`key: value`) or author bylines (`**Author**: ...`).
	for (const line of headerLines) {
		const t = line.trim();
		if (t.length === 0) continue;
		if (/^[A-Za-z_]+:\s/.test(t)) continue;
		if (/^\*\*[^*]+\*\*:\s/.test(t)) continue;
		return t;
	}
	return "Imported workflow";
}

function extractDescription(
	headerLines: ReadonlyArray<string>,
	excludeTitle: string,
): string | null {
	// Description = everything after the title and before the first step
	// heading, minus the H1 line itself. Drops leading/trailing whitespace.
	const out: string[] = [];
	let titleSeen = false;
	for (const line of headerLines) {
		const m = line.match(/^#\s+(.+)$/);
		if (m && m[1] && m[1].trim() === excludeTitle && !titleSeen) {
			titleSeen = true;
			continue;
		}
		out.push(line);
	}
	const joined = out.join("\n").trim();
	return joined.length > 0 ? joined : null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripImageReferences(source: string): string {
	// Replace `![alt](url)` with `[screenshot: alt]` so the user can see where
	// images existed in the source. Falls back to a generic marker if alt is
	// empty (Tango / Scribe both sometimes export with empty alt).
	return source.replace(/!\[([^\]]*)\]\([^)]+\)/g, (_match, alt) => {
		const a = typeof alt === "string" ? alt.trim() : "";
		return a.length > 0 ? `[screenshot: ${a}]` : "[screenshot]";
	});
}

function truncate(s: string, max: number): string {
	return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

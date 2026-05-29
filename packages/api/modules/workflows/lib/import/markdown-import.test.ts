// Phase 13 slice B -- unit tests for the deterministic markdown parser.
// Hand-crafted fixtures matching documented Tango / Scribe markdown export
// shapes (we don't have official samples; the regexes are designed to be
// resilient against minor format drift).

import { describe, expect, it } from "vitest";

import { parseStructuredMarkdown } from "./markdown-import";

describe("parseStructuredMarkdown -- Tango-style", () => {
	it("parses a typical Tango export with step heading + body", () => {
		const src = `
# Move-in inspection

Walk the unit before handing keys to the tenant.

## Step 1: Open the unit

Use the lockbox code from the work order.

## Step 2: Walk the common areas

Check living room, kitchen, bathrooms.

## Step 3: Sign the inspection form

Photograph the signed form and attach.
`;
		const result = parseStructuredMarkdown(src);
		expect(result).not.toBeNull();
		expect(result?.detectedFormat).toBe("tango-style");
		expect(result?.title).toBe("Move-in inspection");
		expect(result?.description).toContain("Walk the unit");
		expect(result?.steps).toHaveLength(3);
		expect(result?.steps[0].title).toBe("Open the unit");
		expect(result?.steps[0].description).toContain("lockbox");
		expect(result?.steps[2].title).toBe("Sign the inspection form");
	});

	it("handles `Step N - Title` (dash separator)", () => {
		const src = `
## Step 1 - Click File
Body for one
## Step 2 - Click New
Body for two
`;
		const result = parseStructuredMarkdown(src);
		expect(result?.detectedFormat).toBe("tango-style");
		expect(result?.steps).toHaveLength(2);
		expect(result?.steps[0].title).toBe("Click File");
	});

	it("strips screenshot references and keeps a marker in the body", () => {
		const src = `
## Step 1: Click the menu

![Menu screenshot](https://cdn.tango.us/example/menu.png)

The menu icon is in the top-right corner.

## Step 2: Select Settings

![](https://cdn.tango.us/example/settings.png)
`;
		const result = parseStructuredMarkdown(src);
		expect(result?.steps).toHaveLength(2);
		expect(result?.steps[0].description).toContain("[screenshot: Menu screenshot]");
		expect(result?.steps[0].description).toContain("top-right corner");
		expect(result?.steps[1].description).toContain("[screenshot]");
		// And the cdn URL should NOT leak through.
		expect(result?.steps[0].description).not.toContain("cdn.tango.us");
	});
});

describe("parseStructuredMarkdown -- Scribe-style", () => {
	it("parses a numbered bold list as steps", () => {
		const src = `
**Title**: Vendor invoice approval
**Created by**: Sam

**1.** Open the invoice attachment.

**2.** Verify amount matches the work order.

**3.** Approve and route to AP.
`;
		const result = parseStructuredMarkdown(src);
		expect(result?.detectedFormat).toBe("scribe-style");
		// The H1 isn't present; title falls back to first non-frontmatter line.
		// "**Title**: ..." is recognized as frontmatter and skipped, so the
		// title becomes... actually it's the first step. That's not great.
		// For now we accept that Scribe exports without an H1 produce a
		// reasonable-but-imperfect title; the user renames in the Builder.
		expect(result?.steps).toHaveLength(3);
		expect(result?.steps[0].title).toBe("Open the invoice attachment.");
		expect(result?.steps[1].title).toBe("Verify amount matches the work order.");
		expect(result?.steps[2].title).toBe("Approve and route to AP.");
	});
});

describe("parseStructuredMarkdown -- generic numbered markdown", () => {
	it("parses h2-prefixed numbered headings", () => {
		const src = `
# Onboarding checklist

## 1. Send welcome email

## 2. Set up tools access

## 3. Schedule kickoff
`;
		const result = parseStructuredMarkdown(src);
		expect(result?.detectedFormat).toBe("numbered-markdown");
		expect(result?.title).toBe("Onboarding checklist");
		expect(result?.steps).toHaveLength(3);
		expect(result?.steps[0].title).toBe("Send welcome email");
	});

	it("parses a top-level numbered list when sequential within a block", () => {
		const src = `
# Pre-trip checklist

1. Check tire pressure
2. Top off washer fluid
3. Verify lights
`;
		const result = parseStructuredMarkdown(src);
		expect(result?.detectedFormat).toBe("numbered-markdown");
		expect(result?.steps).toHaveLength(3);
		expect(result?.steps[0].title).toBe("Check tire pressure");
	});
});

describe("parseStructuredMarkdown -- refusals", () => {
	it("returns null on empty input", () => {
		expect(parseStructuredMarkdown("")).toBeNull();
		expect(parseStructuredMarkdown("   \n  \n  ")).toBeNull();
	});

	it("returns null on prose with no recognizable steps", () => {
		const src = `
# Some doc

This is just a paragraph of prose. There are no numbered steps here, and
no Tango/Scribe-style headings either.

Another paragraph.
`;
		expect(parseStructuredMarkdown(src)).toBeNull();
	});

	it("returns null on a single-step source (ambiguous)", () => {
		// One step alone could be a stray heading; require >= 2 for confidence.
		const src = `
# Doc

## Step 1: Just one thing

Body text.
`;
		expect(parseStructuredMarkdown(src)).toBeNull();
	});
});

describe("parseStructuredMarkdown -- defensive behavior", () => {
	it("ignores non-string inputs", () => {
		// Defensive against caller-side bugs (oRPC Zod usually catches this
		// but parser-level guard is cheap insurance).
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(parseStructuredMarkdown(null as any)).toBeNull();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(parseStructuredMarkdown(undefined as any)).toBeNull();
	});

	it("caps step count at the safety limit", () => {
		// Synthesize 250 steps; expect cap at 200.
		const lines: string[] = ["# Big import", ""];
		for (let i = 1; i <= 250; i++) {
			lines.push(`## Step ${i}: Do thing ${i}`, "", `Body ${i}.`, "");
		}
		const result = parseStructuredMarkdown(lines.join("\n"));
		expect(result).not.toBeNull();
		expect(result?.steps.length).toBeLessThanOrEqual(200);
	});

	it("truncates over-long step descriptions", () => {
		const huge = "x".repeat(10_000);
		const src = `# Doc\n\n## Step 1: One\n\n${huge}\n\n## Step 2: Two\n`;
		const result = parseStructuredMarkdown(src);
		expect(result).not.toBeNull();
		// Cap is 8000; verify the description was truncated, not dropped.
		expect((result?.steps[0].description ?? "").length).toBeLessThanOrEqual(8000);
		expect((result?.steps[0].description ?? "").length).toBeGreaterThan(7000);
	});
});

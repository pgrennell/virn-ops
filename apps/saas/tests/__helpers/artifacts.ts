// E2E artifacts directory resolver.
//
// Per the agents.md convention (`docs/reviews/<feature-name>/`), UI Walkthrough
// screenshots live inside the repo so they're accessible to Claude Code and
// other workspace agents. Use this helper instead of hardcoding paths -- a
// hardcoded `C:\Users\...` path makes the test machine-specific.
//
// Override the root with PLAYWRIGHT_ARTIFACTS_DIR when a one-off external sink
// is desired (e.g. an Antigravity brain artifact directory). The per-spec
// subfolder name is appended in either case.

import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_ROOT = path.resolve(__dirname, "../../../../docs/reviews");

export function getArtifactsDir(specName: string): string {
	const root = process.env.PLAYWRIGHT_ARTIFACTS_DIR ?? DEFAULT_ROOT;
	const dir = path.join(root, specName);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

// E2E mail-capture helpers. The app server runs with MAIL_PROVIDER=capture (see
// packages/mail/provider/capture.ts), which appends each sent email as a JSON line to
// MAIL_CAPTURE_FILE. These helpers read that file to pull the verification / magic-link /
// reset URL straight from the email -- needed because better-auth's email-verification token
// is a SIGNED token embedded in the URL, not a `verification` table row, so it can't be read
// from the DB.

import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CAPTURE_FILE = process.env.MAIL_CAPTURE_FILE ?? join(tmpdir(), "virn-mail-capture.jsonl");

export interface CapturedEmail {
	to: string;
	subject: string;
	text: string;
	html: string;
	at: string;
}

/** Block-and-wait for the most recent captured email addressed to `to`. */
export async function waitForCapturedEmail(
	to: string,
	options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<CapturedEmail> {
	const { timeoutMs = 15_000, pollIntervalMs = 150 } = options;
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		if (existsSync(CAPTURE_FILE)) {
			const lines = readFileSync(CAPTURE_FILE, "utf8").split("\n").filter(Boolean);
			// Newest first -- emails are unique per test (nonce address), so the last match wins.
			for (let i = lines.length - 1; i >= 0; i--) {
				try {
					const row = JSON.parse(lines[i]) as CapturedEmail;
					if (row.to === to) return row;
				} catch {
					// skip a partially-written final line
				}
			}
		}
		await new Promise((r) => setTimeout(r, pollIntervalMs));
	}

	throw new Error(
		`Timed out waiting for a captured email to ${to}. Is the app server running with ` +
			`MAIL_PROVIDER=capture and the same MAIL_CAPTURE_FILE (${CAPTURE_FILE})?`,
	);
}

/** Extract the auth action URL (verify-email / magic-link / reset-password) from a captured
 * email. Prefers the plaintext body (no HTML-entity encoding); falls back to the HTML with
 * `&amp;` decoded so query strings survive. */
export function extractAuthUrl(email: CapturedEmail): string {
	const candidates = [email.text, email.html.replace(/&amp;/g, "&")];
	const patterns = [
		/https?:\/\/[^\s"'<>]*\/api\/auth\/[^\s"'<>)]+/,
		/https?:\/\/[^\s"'<>]*[?&]token=[^\s"'<>)]+/,
	];
	for (const body of candidates) {
		for (const re of patterns) {
			const m = body.match(re);
			if (m) return m[0];
		}
	}
	throw new Error(`No auth URL found in the captured email to ${email.to}`);
}

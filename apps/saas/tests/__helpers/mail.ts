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

function readCaptured(): CapturedEmail[] {
	if (!existsSync(CAPTURE_FILE)) return [];
	return readFileSync(CAPTURE_FILE, "utf8")
		.split("\n")
		.filter(Boolean)
		.flatMap((line) => {
			try {
				return [JSON.parse(line) as CapturedEmail];
			} catch {
				return []; // skip a partially-written final line
			}
		});
}

/** Pull the first URL matching `urlMatch` from an email's body (plaintext first, then HTML
 * with `&amp;` decoded so query strings survive). Returns null when none matches. */
function urlFrom(email: CapturedEmail, urlMatch: RegExp): string | null {
	const bodies = [email.text, email.html.replace(/&amp;/g, "&")];
	for (const body of bodies) {
		for (const m of body.matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
			if (urlMatch.test(m[0])) return m[0];
		}
	}
	return null;
}

/**
 * Block-and-wait for the most recent captured email to `to` that contains an auth URL matching
 * `urlMatch`, and return that URL. Skipping non-matching emails is important: signup sends BOTH
 * a "verify your email" and a "welcome" email, and we must pick the one with the verify link
 * (returning "latest email" blindly is a race that sometimes grabs the welcome email).
 */
export async function waitForAuthUrl(
	to: string,
	urlMatch: RegExp = /\/api\/auth\/|[?&]token=/,
	options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<string> {
	const { timeoutMs = 15_000, pollIntervalMs = 150 } = options;
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		const emails = readCaptured().filter((e) => e.to === to);
		for (let i = emails.length - 1; i >= 0; i--) {
			const url = urlFrom(emails[i], urlMatch);
			if (url) return url;
		}
		await new Promise((r) => setTimeout(r, pollIntervalMs));
	}

	throw new Error(
		`Timed out waiting for an auth URL (match ${urlMatch}) in a captured email to ${to}. ` +
			`Is the app server running with MAIL_PROVIDER=capture and the same MAIL_CAPTURE_FILE ` +
			`(${CAPTURE_FILE})?`,
	);
}

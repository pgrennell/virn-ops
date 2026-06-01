import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SendEmailHandler } from "../types";

// Test-only mail provider (MAIL_PROVIDER=capture). Appends each "sent" email as a JSON line to
// a capture file so e2e tests can read the verification / magic-link / password-reset URL
// straight from the email body. This is necessary because better-auth's email-verification
// embeds a SIGNED token in the URL and does NOT write a `verification` table row -- so the
// DB-polling helpers can't retrieve it; the only place the token lives is the email link.
//
// Never throws: a capture failure must not break the auth flow it instruments.
const CAPTURE_FILE = process.env.MAIL_CAPTURE_FILE ?? join(tmpdir(), "virn-mail-capture.jsonl");

export const send: SendEmailHandler = async ({ to, subject, text, html }) => {
	try {
		appendFileSync(
			CAPTURE_FILE,
			`${JSON.stringify({ to, subject, text, html: html ?? "", at: new Date().toISOString() })}\n`,
		);
	} catch {
		// best-effort capture
	}
};

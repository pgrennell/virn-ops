// Mail provider selection. Defaults to `plunk` (the previously hardcoded provider) but is now
// overridable via MAIL_PROVIDER -- notably `console`, which logs the email instead of sending it
// (its send handler never throws). e2e and local dev set MAIL_PROVIDER=console so flows that
// depend on a send completing without error work without a real mail service / live API key.

import type { SendEmailHandler } from "../types";

import { send as consoleSend } from "./console";
import { send as plunkSend } from "./plunk";

const PROVIDERS: Record<string, SendEmailHandler> = {
	plunk: plunkSend,
	console: consoleSend,
};

export const send: SendEmailHandler = PROVIDERS[process.env.MAIL_PROVIDER ?? "plunk"] ?? plunkSend;

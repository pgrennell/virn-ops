import type { MailMessages } from "@virn/i18n";

declare global {
	interface IntlMessages extends MailMessages {}
}

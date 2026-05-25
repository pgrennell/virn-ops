import type { SaasMessages } from "@virn/i18n";
import { getMessagesForLocale as getMessages } from "@virn/i18n";

export const getMessagesForLocale = async (locale: string): Promise<SaasMessages> => {
	return getMessages(locale as Parameters<typeof getMessages>[0], "saas");
};

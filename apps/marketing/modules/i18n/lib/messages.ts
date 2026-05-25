import type { MarketingMessages } from "@virn/i18n";
import { getMessagesForLocale as getMessages } from "@virn/i18n";

export const getMessagesForLocale = async (locale: string): Promise<MarketingMessages> => {
	return getMessages(locale as Parameters<typeof getMessages>[0], "marketing");
};

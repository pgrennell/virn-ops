"use server";

import { config as i18nConfig, type Locale } from "@virn/i18n";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

export async function updateLocale(locale: Locale) {
	(await cookies()).set(i18nConfig.localeCookieName, locale);
	revalidatePath("/");
}

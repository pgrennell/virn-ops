import { getBaseUrl as getBaseUrlFromUtils } from "@virn/utils";

export function getBaseUrl() {
	return getBaseUrlFromUtils(process.env.NEXT_PUBLIC_MARKETING_URL, 3001);
}

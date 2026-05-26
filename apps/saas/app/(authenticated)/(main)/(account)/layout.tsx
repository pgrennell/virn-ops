import { getSession } from "@auth/lib/server";
import { AccountShell } from "@shared/components/AccountShell";
import { SIDEBAR_COLLAPSED_COOKIE } from "@shared/lib/sidebar-context";
import { cookies } from "next/headers";
import type { PropsWithChildren } from "react";

export default async function AccountLayout({ children }: PropsWithChildren) {
	const session = await getSession();
	// Server-hydrate sidebar collapsed state so the first paint matches the user's
	// persisted preference instead of flashing 280px → 80px.
	const cookieStore = await cookies();
	const initialCollapsed = cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === "true";
	const isPlatformAdmin = session?.user?.role === "admin";

	return (
		<AccountShell isPlatformAdmin={isPlatformAdmin} initialCollapsed={initialCollapsed}>
			{children}
		</AccountShell>
	);
}

"use client";

import Cookies from "js-cookie";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

export const SIDEBAR_COLLAPSED_COOKIE = "sidebar-collapsed";

interface SidebarContextValue {
	isCollapsed: boolean;
	toggleCollapsed: () => void;
}

const SidebarContext = createContext<SidebarContextValue | undefined>(undefined);

/**
 * Hydrate the collapsed state from a server-resolved cookie so the first paint
 * matches the persisted preference (no 280px→80px flash on collapsed sessions).
 * `initialCollapsed` should be derived in the layout via `next/headers.cookies()`
 * and passed down — see AppShell / AccountShell.
 */
export function SidebarProvider({
	children,
	initialCollapsed = false,
}: {
	children: ReactNode;
	initialCollapsed?: boolean;
}) {
	const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);

	const toggleCollapsed = () => {
		const newValue = !isCollapsed;
		setIsCollapsed(newValue);
		Cookies.set(SIDEBAR_COLLAPSED_COOKIE, newValue ? "true" : "false", { expires: 365 });
	};

	const value = useMemo(
		() => ({ isCollapsed, toggleCollapsed }),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[isCollapsed],
	);

	return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
	const context = useContext(SidebarContext);
	if (context === undefined) {
		throw new Error("useSidebar must be used within a SidebarProvider");
	}
	return context;
}

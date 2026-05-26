"use client";

import { cn } from "@virn/ui";
import type { PropsWithChildren } from "react";
import { useMemo } from "react";

import { ACCOUNT_NAV_GROUPS, PLATFORM_ADMIN_NAV_GROUP } from "../lib/nav";
import { SidebarProvider, useSidebar } from "../lib/sidebar-context";
import { Sidebar, type SidebarNavGroup } from "./Sidebar";
import { TopBar } from "./TopBar";

interface AccountShellProps {
	/** True if the viewer is a platform admin (Better Auth `user.role === "admin"`).
	 * Distinct from org-admin (a membership role on a specific organization). */
	isPlatformAdmin?: boolean;
	/** Server-resolved initial value of the collapsed cookie so first paint matches. */
	initialCollapsed?: boolean;
}

function ShellInner({
	isPlatformAdmin,
	children,
}: PropsWithChildren<{ isPlatformAdmin?: boolean }>) {
	const { isCollapsed } = useSidebar();
	const groups = useMemo<SidebarNavGroup[]>(() => {
		const base = ACCOUNT_NAV_GROUPS.map((g) => ({
			id: g.id,
			label: g.label,
			items: g.items.map((i) => ({ id: i.id, href: i.href, icon: i.icon, label: i.label })),
		}));
		if (isPlatformAdmin) {
			base.push({
				id: PLATFORM_ADMIN_NAV_GROUP.id,
				label: PLATFORM_ADMIN_NAV_GROUP.label,
				items: PLATFORM_ADMIN_NAV_GROUP.items.map((i) => ({
					id: i.id,
					href: i.href,
					icon: i.icon,
					label: i.label,
				})),
			});
		}
		return base;
	}, [isPlatformAdmin]);

	return (
		<div className="min-h-screen bg-background">
			<Sidebar groups={groups} homeHref="/" />
			<div
				className={cn(
					"flex min-h-screen flex-col transition-[margin]",
					isCollapsed ? "md:ml-[80px]" : "md:ml-[280px]",
				)}
			>
				<TopBar mobileGroups={groups} />
				<main className="flex-1 px-4 py-6 md:px-8">{children}</main>
			</div>
		</div>
	);
}

export function AccountShell({
	children,
	isPlatformAdmin = false,
	initialCollapsed = false,
}: PropsWithChildren<AccountShellProps>) {
	return (
		<SidebarProvider initialCollapsed={initialCollapsed}>
			<ShellInner isPlatformAdmin={isPlatformAdmin}>{children}</ShellInner>
		</SidebarProvider>
	);
}

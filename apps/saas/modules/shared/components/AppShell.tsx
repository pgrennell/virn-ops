"use client";

import { cn } from "@virn/ui";
import type { PropsWithChildren } from "react";
import { useMemo } from "react";

import { canSee, type GatingSnapshot } from "../lib/gating";
import { NAV_GROUPS, navHref, type RoleId } from "../lib/nav";
import { SidebarProvider, useSidebar } from "../lib/sidebar-context";
import { Sidebar, type SidebarNavGroup } from "./Sidebar";
import { TopBar } from "./TopBar";

interface AppShellProps {
	orgSlug: string;
	snapshot: GatingSnapshot;
	role: RoleId;
	/** Server-resolved initial value of the collapsed cookie so first paint matches. */
	initialCollapsed?: boolean;
}

function resolveOrgGroups(orgSlug: string, snapshot: GatingSnapshot): SidebarNavGroup[] {
	return NAV_GROUPS.map((group) => ({
		id: group.id,
		label: group.label,
		items: group.items
			.filter((item) => canSee(item.area, snapshot))
			.map((item) => ({
				id: item.area,
				href: navHref(orgSlug, item.segment),
				icon: item.icon,
				label: item.label,
			})),
	})).filter((g) => g.items.length > 0);
}

function ShellInner({
	orgSlug,
	snapshot,
	role,
	children,
}: PropsWithChildren<Omit<AppShellProps, "initialCollapsed">>) {
	const { isCollapsed } = useSidebar();
	const groups = useMemo(() => resolveOrgGroups(orgSlug, snapshot), [orgSlug, snapshot]);

	return (
		<div className="min-h-screen bg-background">
			<Sidebar groups={groups} homeHref={`/${orgSlug}`} />
			<div
				className={cn(
					"flex min-h-screen flex-col transition-[margin]",
					isCollapsed ? "md:ml-[80px]" : "md:ml-[280px]",
				)}
			>
				<TopBar mobileGroups={groups} org={{ orgSlug, snapshot, role }} />
				<main className="flex-1 px-4 py-6 md:px-8">{children}</main>
			</div>
		</div>
	);
}

export function AppShell({
	children,
	orgSlug,
	snapshot,
	role,
	initialCollapsed = false,
}: PropsWithChildren<AppShellProps>) {
	return (
		<SidebarProvider initialCollapsed={initialCollapsed}>
			<ShellInner orgSlug={orgSlug} snapshot={snapshot} role={role}>
				{children}
			</ShellInner>
		</SidebarProvider>
	);
}

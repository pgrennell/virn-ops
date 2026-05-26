"use client";

import {
	Button,
	cn,
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@virn/ui";
import { MenuIcon } from "lucide-react";
import { useState } from "react";

import type { GatingSnapshot } from "../lib/gating";
import type { RoleId } from "../lib/nav";
import { AdminAllAccessBadge } from "./AdminAllAccessBadge";
import { CreateMenu } from "./CreateMenu";
import { GlobalSearch } from "./GlobalSearch";
import { NotificationCenter } from "./NotificationCenter";
import { MobileSidebar, type SidebarNavGroup } from "./Sidebar";

interface TopBarProps {
	/** Sidebar nav groups for the mobile sheet rendering. */
	mobileGroups: readonly SidebarNavGroup[];
	/** Show the org switcher inside the mobile sheet. Mirrors the desktop Sidebar prop. */
	mobileShowOrgSwitcher?: boolean;
	/**
	 * Org context — present on org-scoped routes only. When absent (account routes),
	 * the Create menu and admin-all-access badge are hidden.
	 */
	org?: {
		orgSlug: string;
		snapshot: GatingSnapshot;
		role: RoleId;
	};
}

export function TopBar({ mobileGroups, mobileShowOrgSwitcher = true, org }: TopBarProps) {
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

	return (
		<header
			className={cn(
				"sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/90 backdrop-blur",
				"px-4 md:px-6",
			)}
		>
			<Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
				<SheetTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="md:hidden"
						aria-label="Open navigation"
					>
						<MenuIcon className="size-5" />
					</Button>
				</SheetTrigger>
				<SheetContent side="left" className="p-0 sm:max-w-[280px] w-[min(100vw,280px)]">
					<SheetHeader className="sr-only">
						<SheetTitle>Navigation</SheetTitle>
					</SheetHeader>
					<MobileSidebar
						groups={mobileGroups}
						showOrgSwitcher={mobileShowOrgSwitcher}
						onLinkClick={() => setMobileMenuOpen(false)}
					/>
				</SheetContent>
			</Sheet>

			<div className="flex-1 min-w-0 max-w-md">
				<GlobalSearch />
			</div>

			<div className="ml-auto flex items-center gap-2">
				{org && <CreateMenu orgSlug={org.orgSlug} snapshot={org.snapshot} />}
				<NotificationCenter />
				{org && <AdminAllAccessBadge role={org.role} className="hidden md:inline-flex" />}
			</div>
		</header>
	);
}

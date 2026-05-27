"use client";

import { cn, Logo } from "@virn/ui";
import { Button } from "@virn/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@virn/ui/components/tooltip";
import {
	BarChart3,
	Bell,
	Bot,
	BotMessageSquare,
	Briefcase,
	CheckSquare,
	CreditCard,
	Database,
	Folder,
	Home,
	LayoutGrid,
	Lock,
	type LucideIcon,
	PanelLeftCloseIcon,
	PanelLeftOpenIcon,
	Palette,
	Play,
	Plug,
	Settings,
	Shield,
	ShieldUser,
	SlidersHorizontal,
	UserCog,
	Users,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { OrganizationSelect } from "../../organizations/components/OrganizationSelect";
import { useIsMobile } from "../hooks/use-media-query";
import { useSidebar } from "../lib/sidebar-context";
import { UserMenu } from "./UserMenu";

const ICON_MAP: Record<string, LucideIcon> = {
	BarChart3,
	Bell,
	Bot,
	BotMessageSquare,
	Briefcase,
	CheckSquare,
	CreditCard,
	Database,
	Folder,
	Home,
	LayoutGrid,
	Lock,
	Palette,
	Play,
	Plug,
	Settings,
	Shield,
	ShieldUser,
	SlidersHorizontal,
	UserCog,
	Users,
	Zap,
};

// ---------------------------------------------------------------------------
// Generic group shape rendered by the sidebar. Org and account shells map their
// own structures into this; the Sidebar component itself stays context-agnostic.
// ---------------------------------------------------------------------------

export interface SidebarNavItem {
	id: string;
	href: string;
	/** Icon name — must be a key of ICON_MAP. */
	icon: string;
	label: string;
}

export interface SidebarNavGroup {
	id: string;
	/** Group heading. Omit (empty string) for a single-group nav that doesn't need a heading. */
	label: string;
	items: readonly SidebarNavItem[];
}

interface SidebarProps {
	groups: readonly SidebarNavGroup[];
	/** Where the logo links to. Org context: `/${slug}`. Account context: `/`. */
	homeHref: string;
	/** Show the org switcher above the nav. Default true. */
	showOrgSwitcher?: boolean;
}

function isItemActive(pathname: string, href: string): boolean {
	// Strip query string for comparison so links with `?new=…` still highlight correctly.
	const cleanHref = href.split("?")[0];
	return pathname === cleanHref || pathname.startsWith(`${cleanHref}/`);
}

function GroupHeading({ label, collapsed }: { label: string; collapsed: boolean }) {
	if (!label) return null;
	if (collapsed) {
		return <div className="mt-3 mb-1 h-px bg-border/40 mx-2" aria-hidden />;
	}
	return (
		<p className="mt-4 mb-1 px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
			{label}
		</p>
	);
}

function SidebarLinkRow({
	item,
	pathname,
	collapsed,
	onLinkClick,
}: {
	item: SidebarNavItem;
	pathname: string;
	collapsed: boolean;
	onLinkClick?: () => void;
}) {
	const Icon = ICON_MAP[item.icon] ?? Home;
	const active = isItemActive(pathname, item.href);

	const link = (
		<Link
			href={item.href}
			prefetch
			onClick={onLinkClick}
			className={cn(
				"gap-3 px-3 py-2 text-sm flex w-full items-center rounded-lg border border-transparent whitespace-nowrap transition-colors",
				{
					"font-semibold border-border bg-card": active,
					"hover:bg-accent/50": !active,
					"justify-center px-2": collapsed,
				},
			)}
		>
			<Icon
				className={cn(
					"size-5 shrink-0",
					active ? "text-foreground" : "text-muted-foreground opacity-60",
				)}
			/>
			{!collapsed && (
				<span className={cn(active ? "text-foreground" : "text-muted-foreground")}>
					{item.label}
				</span>
			)}
		</Link>
	);

	if (collapsed) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>{link}</TooltipTrigger>
				<TooltipContent side="right">{item.label}</TooltipContent>
			</Tooltip>
		);
	}
	return link;
}

function NavList({
	groups,
	collapsed,
	onLinkClick,
}: {
	groups: readonly SidebarNavGroup[];
	collapsed: boolean;
	onLinkClick?: () => void;
}) {
	const pathname = usePathname();

	return (
		<TooltipProvider delayDuration={0}>
			<nav className="flex flex-col gap-0.5 px-2 pb-4">
				{groups.map((group) => (
					<div key={group.id}>
						<GroupHeading label={group.label} collapsed={collapsed} />
						<ul className="flex flex-col gap-0.5 list-none">
							{group.items.map((item) => (
								<li key={item.id}>
									<SidebarLinkRow
										item={item}
										pathname={pathname}
										collapsed={collapsed}
										onLinkClick={onLinkClick}
									/>
								</li>
							))}
						</ul>
					</div>
				))}
			</nav>
		</TooltipProvider>
	);
}

export function Sidebar({ groups, homeHref, showOrgSwitcher = true }: SidebarProps) {
	const { isCollapsed, toggleCollapsed } = useSidebar();
	const isMobile = useIsMobile();
	const collapsed = isCollapsed && !isMobile;

	return (
		<aside
			className={cn(
				"md:fixed md:top-0 md:left-0 md:h-full md:flex md:flex-col bg-background border-r",
				collapsed ? "md:w-[80px]" : "md:w-[280px]",
				"hidden md:flex",
			)}
		>
			<div
				className={cn(
					"flex items-center justify-between px-4 py-4",
					collapsed && "px-2 justify-center",
				)}
			>
				<Link href={homeHref} className="block shrink-0" aria-label="Home">
					<Logo withLabel={!collapsed} />
				</Link>
				{!collapsed && (
					<Button
						variant="ghost"
						size="icon"
						onClick={toggleCollapsed}
						aria-label="Collapse sidebar"
					>
						<PanelLeftCloseIcon className="size-4 opacity-60" />
					</Button>
				)}
			</div>

			{collapsed && (
				<div className="flex justify-center pb-2">
					<Button
						variant="ghost"
						size="icon"
						onClick={toggleCollapsed}
						aria-label="Expand sidebar"
					>
						<PanelLeftOpenIcon className="size-4 opacity-60" />
					</Button>
				</div>
			)}

			{showOrgSwitcher && (
				<div className={cn("px-3", collapsed && "px-2")}>
					<OrganizationSelect collapsed={collapsed} />
				</div>
			)}

			<div className="min-h-0 flex-1 overflow-y-auto mt-2">
				<NavList groups={groups} collapsed={collapsed} />
			</div>

			<div className={cn("border-t px-3 py-3", collapsed && "px-2 flex justify-center")}>
				<UserMenu showUserName={!collapsed} />
			</div>
		</aside>
	);
}

export function MobileSidebar({
	groups,
	showOrgSwitcher = true,
	onLinkClick,
}: {
	groups: readonly SidebarNavGroup[];
	showOrgSwitcher?: boolean;
	onLinkClick?: () => void;
}) {
	return (
		<div className="flex h-full flex-col">
			<div className="px-4 py-4">
				<Logo withLabel />
			</div>
			{showOrgSwitcher && (
				<div className="px-3">
					<OrganizationSelect />
				</div>
			)}
			<div className="min-h-0 flex-1 overflow-y-auto mt-2">
				<NavList groups={groups} collapsed={false} onLinkClick={onLinkClick} />
			</div>
			<div className="border-t px-3 py-3">
				<UserMenu showUserName />
			</div>
		</div>
	);
}

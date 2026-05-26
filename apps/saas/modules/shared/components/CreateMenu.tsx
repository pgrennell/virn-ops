"use client";

import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@virn/ui";
import {
	FileTextIcon,
	FormInputIcon,
	ImportIcon,
	PlusIcon,
	ShieldCheckIcon,
	WorkflowIcon,
} from "lucide-react";
import Link from "next/link";

import { canSee, type GatingSnapshot } from "../lib/gating";
import { NAV_AREAS, navHref } from "../lib/nav";

// UX_SPEC §7 "+ Create menu" — single primary action with a type menu.
// Items here are intent-only placeholders; their target pages are placeholders too.

interface CreateMenuItem {
	label: string;
	icon: typeof PlusIcon;
	href: string;
	area: typeof NAV_AREAS.library | typeof NAV_AREAS.templates;
}

export function CreateMenu({ orgSlug, snapshot }: { orgSlug: string; snapshot: GatingSnapshot }) {
	const items: CreateMenuItem[] = [
		{
			label: "Workflow",
			icon: WorkflowIcon,
			href: navHref(orgSlug, "library?new=workflow"),
			area: NAV_AREAS.library,
		},
		{
			label: "SOP or policy",
			icon: FileTextIcon,
			href: navHref(orgSlug, "library?new=sop"),
			area: NAV_AREAS.library,
		},
		{
			label: "Form",
			icon: FormInputIcon,
			href: navHref(orgSlug, "library?new=form"),
			area: NAV_AREAS.library,
		},
	];

	const importItem: CreateMenuItem = {
		label: "Import from template",
		icon: ImportIcon,
		href: navHref(orgSlug, "templates"),
		area: NAV_AREAS.templates,
	};

	const visible = items.filter((i) => canSee(i.area, snapshot));
	const showImport = canSee(importItem.area, snapshot);

	if (visible.length === 0 && !showImport) {
		return null;
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button size="sm" className="gap-1">
					<PlusIcon className="size-4" />
					Create
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-56">
				<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
					Create
				</DropdownMenuLabel>
				{visible.map((item) => (
					<DropdownMenuItem key={item.label} asChild>
						<Link href={item.href} prefetch>
							<item.icon className="mr-2 size-4" />
							{item.label}
						</Link>
					</DropdownMenuItem>
				))}
				{showImport && visible.length > 0 && <DropdownMenuSeparator />}
				{showImport && (
					<DropdownMenuItem asChild>
						<Link href={importItem.href} prefetch>
							<importItem.icon className="mr-2 size-4" />
							{importItem.label}
						</Link>
					</DropdownMenuItem>
				)}
				{snapshot.isAdminSuperset && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem disabled>
							<ShieldCheckIcon className="mr-2 size-4" />
							Admin · all access
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

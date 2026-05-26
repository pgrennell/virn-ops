"use client";

import { cn } from "@virn/ui";

import { ADMIN_SUPERSET_ROLES, type RoleId } from "../lib/nav";

interface Props {
	role: RoleId;
	className?: string;
}

export function AdminAllAccessBadge({ role, className }: Props) {
	if (!(ADMIN_SUPERSET_ROLES as readonly RoleId[]).includes(role)) {
		return null;
	}

	return (
		<span
			className={cn(
				"px-2 py-0.5 text-xs gap-1 inline-flex items-center rounded-full bg-primary/10 text-primary",
				className,
			)}
			title="Admin role bypasses the permission axis and sees every capability-enabled area (UX_SPEC §2)."
		>
			<span className="size-1.5 rounded-full bg-primary" aria-hidden />
			Admin · all access
		</span>
	);
}

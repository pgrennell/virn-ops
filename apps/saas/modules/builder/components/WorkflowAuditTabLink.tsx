// Phase 15 -- per-workflow Audit tab link (compliance / evidence reader).
//
// Lives next to WorkflowViewToggle + WorkflowRunsTabLink in the workflow
// detail header. Same architectural posture as WorkflowRunsTabLink (Phase 14):
// not a segment of the Author|Read toggle -- it's an instances-of-the-object
// surface (audit history of this workflow), not a view of the object itself.
//
// Gating: hidden unless canSee(NAV_AREAS.compliance, snapshot) -- which
// composes capability=compliance.pack + role in {reviewer, admin, owner}.
// Pages thread the resolved boolean as `canSeeCompliance`.

import { cn } from "@virn/ui";
import { ShieldCheck } from "lucide-react";

interface WorkflowAuditTabLinkProps {
	organizationSlug: string;
	workflowId: string;
	/** When true the link renders in the "current page" treatment for the per-
	 * workflow Audit route. When false it's a passive link from Builder / Read /
	 * Runs. */
	active: boolean;
}

export function WorkflowAuditTabLink({
	organizationSlug,
	workflowId,
	active,
}: WorkflowAuditTabLinkProps) {
	return (
		<a
			href={`/${organizationSlug}/library/workflows/${workflowId}/audit`}
			aria-current={active ? "page" : undefined}
			className={cn(
				"inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
				active
					? "border-border bg-muted text-foreground"
					: "border-border bg-background text-foreground/60 hover:text-foreground hover:bg-muted/40",
			)}
		>
			<ShieldCheck className="size-3" />
			Audit
		</a>
	);
}

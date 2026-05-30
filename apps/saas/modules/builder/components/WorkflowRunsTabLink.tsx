// Phase 14 -- per-workflow Runs tab link.
//
// Sits next to WorkflowViewToggle in the workflow detail header but is its own
// component, not a third segment of the Author|Read toggle. The view-switcher
// is "three views of one object" (PRD §1.2 / D-039: SOP / KB / runnable);
// Runs are *instances* of the workflow, not a view of it -- conflating them
// muddies the model. Hence: separate pill, separate state, separate gate
// (`canSee(NAV_AREAS.runs)` not the library/sop gate).

import { cn } from "@virn/ui";
import { Play } from "lucide-react";

interface WorkflowRunsTabLinkProps {
	organizationSlug: string;
	workflowId: string;
	/** When true the link renders in the "current page" treatment for the per-
	 * workflow Runs route. When false it's a passive link from Builder / Read. */
	active: boolean;
}

export function WorkflowRunsTabLink({
	organizationSlug,
	workflowId,
	active,
}: WorkflowRunsTabLinkProps) {
	return (
		<a
			href={`/${organizationSlug}/library/workflows/${workflowId}/runs`}
			aria-current={active ? "page" : undefined}
			className={cn(
				"inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
				active
					? "border-border bg-muted text-foreground"
					: "border-border bg-background text-foreground/60 hover:text-foreground hover:bg-muted/40",
			)}
		>
			<Play className="size-3" />
			Runs
		</a>
	);
}

import { Card } from "@virn/ui";
import { ConstructionIcon } from "lucide-react";

import { PageHeader } from "./PageHeader";

interface Props {
	title: string;
	subtitle?: string;
	phase?: "now" | "defer-design";
	note?: string;
}

// Placeholder chrome for every nav route until its dedicated screen prompt lands.
// Keeping a uniform "coming next" surface makes it obvious during foundation review
// which slots are wired up and which are still empty.

export function PlaceholderScreen({ title, subtitle, phase = "now", note }: Props) {
	const phaseLabel =
		phase === "defer-design" ? "Design deferred (UX_SPEC §5)" : "Coming next";
	return (
		<>
			<PageHeader title={title} subtitle={subtitle} />
			<Card className="p-8">
				<div className="flex items-start gap-3 text-muted-foreground">
					<ConstructionIcon className="size-5 mt-0.5 shrink-0 opacity-60" />
					<div>
						<p className="text-sm font-medium text-foreground">{phaseLabel}</p>
						<p className="text-sm mt-1">
							{note ??
								"This route is scaffolded. The screen will be built in a follow-up prompt."}
						</p>
					</div>
				</div>
			</Card>
		</>
	);
}

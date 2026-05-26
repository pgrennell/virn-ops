"use client";

import { Button } from "@virn/ui/components/button";
import { SearchIcon } from "lucide-react";

// Placeholder for the ⌘K global search (UX_SPEC §3). The command palette
// implementation lands with the Library screen prompt; this is the shell affordance.

export function GlobalSearch() {
	return (
		<Button
			variant="outline"
			size="sm"
			className="text-muted-foreground gap-2 w-full md:w-64 justify-start font-normal"
			onClick={() => {
				// no-op until command palette ships
			}}
		>
			<SearchIcon className="size-4 opacity-60" />
			<span className="flex-1 text-left">Search…</span>
			<kbd className="hidden md:inline-flex items-center gap-1 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
				⌘K
			</kbd>
		</Button>
	);
}

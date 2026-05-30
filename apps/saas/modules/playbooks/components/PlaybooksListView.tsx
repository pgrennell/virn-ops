"use client";

// Phase 18a -- /playbooks list view. Author-grade surface: lists the org's
// playbooks with name + status + activity toggle state. Create new playbook
// via inline form (no separate modal -- keeps the surface simple for v1).
//
// Click a row -> /playbooks/[id]/builder.

import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Badge } from "@virn/ui/components/badge";
import { Button } from "@virn/ui/components/button";
import { Input } from "@virn/ui/components/input";
import { Skeleton } from "@virn/ui/components/skeleton";
import { Plus, Repeat } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface PlaybooksListViewProps {
	organizationSlug: string;
	isAdminOrOwner: boolean;
}

export function PlaybooksListView({
	organizationSlug,
	isAdminOrOwner,
}: PlaybooksListViewProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState("");

	const listQuery = useQuery(orpc.playbooks.list.queryOptions({ input: {} }));

	const createMut = useMutation({
		...orpc.playbooks.create.mutationOptions(),
		onSuccess: (data) => {
			void queryClient.invalidateQueries({ queryKey: orpc.playbooks.list.key() });
			setNewName("");
			setCreating(false);
			router.push(`/${organizationSlug}/playbooks/${data.playbookId}/builder`);
		},
	});

	const onCreate = () => {
		const name = newName.trim();
		if (!name) return;
		createMut.mutate({ name, description: null });
	};

	return (
		<div className="rounded-lg border border-border bg-background overflow-hidden flex flex-col h-full min-h-0">
			<header className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<Repeat className="size-4 text-foreground/60" />
						<h1 className="font-medium text-sm">Playbooks</h1>
					</div>
					<p className="text-xs text-foreground/60 mt-0.5">
						Time-staged + lifecycle-event sequences. Sibling to Workflows.
					</p>
				</div>
				{isAdminOrOwner && !creating && (
					<Button variant="primary" size="sm" onClick={() => setCreating(true)}>
						<Plus className="size-3.5 mr-1" />
						New playbook
					</Button>
				)}
			</header>

			{creating && (
				<div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center gap-2">
					<Input
						value={newName}
						onChange={(e) => setNewName(e.target.value)}
						placeholder="Playbook name (e.g. Post-stay review cadence)"
						disabled={createMut.isPending}
						autoFocus
						onKeyDown={(e) => {
							if (e.key === "Enter") onCreate();
							if (e.key === "Escape") {
								setCreating(false);
								setNewName("");
							}
						}}
						className="flex-1"
					/>
					<Button
						variant="primary"
						size="sm"
						onClick={onCreate}
						disabled={createMut.isPending || newName.trim().length === 0}
					>
						{createMut.isPending ? "Creating…" : "Create"}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							setCreating(false);
							setNewName("");
						}}
						disabled={createMut.isPending}
					>
						Cancel
					</Button>
				</div>
			)}

			{createMut.isError && (
				<div className="px-4 py-2">
					<Alert variant="error">
						<AlertDescription className="text-xs">
							{createMut.error instanceof Error
								? createMut.error.message
								: "Couldn't create playbook."}
						</AlertDescription>
					</Alert>
				</div>
			)}

			<div className="flex-1 min-h-0 overflow-y-auto">
				{listQuery.isLoading ? (
					<TableSkeleton />
				) : listQuery.isError ? (
					<div className="p-4">
						<Alert variant="error">
							<AlertDescription>
								Couldn't load playbooks:{" "}
								{listQuery.error?.message ?? "unknown error"}
							</AlertDescription>
						</Alert>
					</div>
				) : !listQuery.data || listQuery.data.length === 0 ? (
					<div className="px-5 py-16 text-sm text-foreground/60 text-center">
						No playbooks yet.{" "}
						{isAdminOrOwner ? "Click 'New playbook' to author one." : "Ask an admin to create one."}
					</div>
				) : (
					<ul className="divide-y divide-border">
						{listQuery.data.map((row) => (
							<PlaybookRow
								key={row.id}
								row={row}
								organizationSlug={organizationSlug}
							/>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

interface RowData {
	id: string;
	name: string;
	description: string | null;
	isActive: boolean;
	reviewState: "draft" | "in_review" | "published" | "archived";
	updatedAt: Date | string;
}

function PlaybookRow({
	row,
	organizationSlug,
}: {
	row: RowData;
	organizationSlug: string;
}) {
	const updatedAt =
		typeof row.updatedAt === "string" ? new Date(row.updatedAt) : row.updatedAt;
	return (
		<li>
			<a
				href={`/${organizationSlug}/playbooks/${row.id}/builder`}
				className="block px-4 py-3 hover:bg-muted/30 transition-colors flex items-start justify-between gap-3"
			>
				<div className="min-w-0 flex-1">
					<div className="font-medium text-sm">{row.name}</div>
					{row.description && (
						<div className="text-xs text-foreground/60 mt-0.5 truncate">
							{row.description}
						</div>
					)}
					<div className="text-[11px] text-foreground/50 mt-1">
						Edited {updatedAt.toLocaleDateString()}
					</div>
				</div>
				<div className="shrink-0 flex items-center gap-2">
					<Badge status={row.isActive ? "success" : "info"}>
						{row.isActive ? "Active" : "Disabled"}
					</Badge>
					<Badge status={row.reviewState === "published" ? "success" : "warning"}>
						{row.reviewState}
					</Badge>
				</div>
			</a>
		</li>
	);
}

function TableSkeleton() {
	return (
		<div className="px-4 py-3 gap-2 flex flex-col">
			{[0, 1, 2].map((i) => (
				<Skeleton key={i} className="h-14 w-full" />
			))}
		</div>
	);
}

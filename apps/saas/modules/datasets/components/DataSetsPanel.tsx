"use client";

// DataSetsPanel -- top-level client component for /settings/data-sets (Phase 9a,
// S-02 minimal). Org-scoped named lists that `lookup` fields will reference by
// `key` once Phase 9b ships the Builder picker + Run UI renderer.
//
// v1 record convention: each record is { label, value? } -- multi-field records are
// post-v1 per BUILD_PLAN Phase 9.

import { Button } from "@virn/ui/components/button";
import { Spinner } from "@virn/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { Database, Plus } from "lucide-react";
import { useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

import { CreateDataSetDialog } from "./CreateDataSetDialog";
import { DataSetRowMenu } from "./DataSetRowMenu";

export function DataSetsPanel() {
	const dataSetsQuery = useQuery(orpc.dataSets.list.queryOptions({ input: {} }));
	const [createOpen, setCreateOpen] = useState(false);

	const dataSets = dataSetsQuery.data ?? [];

	return (
		<>
			<div className="gap-4 flex items-start justify-between mb-6">
				<div>
					<h2 className="font-medium text-lg mb-1">Data sets</h2>
					<p className="text-sm text-foreground/60 max-w-2xl leading-relaxed">
						Org-scoped named lists that workflow lookup fields reference -- room
						types, common SKUs, vendor categories, anything you want pickable from a
						dropdown across many workflows. Each record carries a label + optional
						structured value.
					</p>
				</div>
				<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)} className="shrink-0">
					<Plus className="size-3.5 mr-1.5" />
					New data set
				</Button>
			</div>

			{dataSetsQuery.isLoading && (
				<div className="py-12 text-foreground/50 gap-2 flex items-center justify-center">
					<Spinner className="size-4" />
					<span className="text-sm">Loading data sets…</span>
				</div>
			)}

			{dataSetsQuery.isError && (
				<div className="py-8 text-sm text-destructive">
					Couldn't load data sets. {dataSetsQuery.error?.message}
				</div>
			)}

			{!dataSetsQuery.isLoading && !dataSetsQuery.isError && dataSets.length === 0 && (
				<div className="py-16 px-6 rounded-md border border-dashed border-border gap-3 flex flex-col items-center text-center">
					<Database className="size-8 text-foreground/40" />
					<div>
						<p className="font-medium text-sm">No data sets yet</p>
						<p className="mt-1 text-xs text-foreground/60 max-w-sm">
							Create a data set to make a list of values reusable across workflows. The
							builder's lookup field type picks from these.
						</p>
					</div>
					<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
						<Plus className="size-3.5 mr-1.5" />
						Create your first data set
					</Button>
				</div>
			)}

			{dataSets.length > 0 && (
				<ul className="divide-y divide-border border border-border rounded-md overflow-hidden">
					{dataSets.map((ds) => (
						<li
							key={ds.id}
							className="px-4 py-3 gap-3 flex items-center bg-background"
						>
							<div className="size-9 shrink-0 rounded-md bg-muted flex items-center justify-center">
								<Database className="size-4 text-foreground/70" />
							</div>
							<div className="flex-1 min-w-0 gap-0.5 flex flex-col">
								<div className="gap-2 flex items-center">
									<span className="font-medium text-sm truncate">{ds.name}</span>
									<span className="shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-muted font-mono text-foreground/60">
										{ds.key}
									</span>
								</div>
								{ds.description && (
									<p className="text-xs text-foreground/60 truncate">{ds.description}</p>
								)}
								<p className="text-[11px] text-foreground/40">
									{ds.recordCount === 0
										? "No records yet"
										: `${ds.recordCount} ${ds.recordCount === 1 ? "record" : "records"}`}
								</p>
							</div>
							<DataSetRowMenu
								dataSetId={ds.id}
								dataSetName={ds.name}
								dataSetKey={ds.key}
								description={ds.description}
							/>
						</li>
					))}
				</ul>
			)}

			<CreateDataSetDialog open={createOpen} onOpenChange={setCreateOpen} />
		</>
	);
}

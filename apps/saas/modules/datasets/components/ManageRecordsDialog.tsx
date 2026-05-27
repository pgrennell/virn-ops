"use client";

// ManageRecordsDialog -- opens from DataSetRowMenu's "Manage records". Fetches the
// data set + its records via dataSets.get and lets the admin add / edit / delete
// records. v1 record shape: { label, value? }; value is captured via the existing
// (free-form) JSON textarea -- multi-field UI is post-v1.

import { Button } from "@virn/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@virn/ui/components/dialog";
import { Input } from "@virn/ui/components/input";
import { Spinner } from "@virn/ui/components/spinner";
import { toastError, toastSuccess } from "@virn/ui/components/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

interface ManageRecordsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	dataSetId: string;
	dataSetName: string;
}

interface EditingRecord {
	id: string | null; // null = new record
	label: string;
	valueText: string; // JSON-as-text; parsed on submit
}

export function ManageRecordsDialog({
	open,
	onOpenChange,
	dataSetId,
	dataSetName,
}: ManageRecordsDialogProps) {
	const queryClient = useQueryClient();
	const detailQuery = useQuery({
		...orpc.dataSets.get.queryOptions({ input: { id: dataSetId } }),
		enabled: open,
	});

	const createMutation = useMutation(orpc.dataSets.createRecord.mutationOptions());
	const updateMutation = useMutation(orpc.dataSets.updateRecord.mutationOptions());
	const deleteMutation = useMutation(orpc.dataSets.deleteRecord.mutationOptions());
	const isPending =
		createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

	const [editing, setEditing] = useState<EditingRecord | null>(null);

	useEffect(() => {
		if (!open) setEditing(null);
	}, [open]);

	const invalidate = () => {
		queryClient.invalidateQueries({
			queryKey: orpc.dataSets.get.queryKey({ input: { id: dataSetId } }),
		});
		queryClient.invalidateQueries({ queryKey: orpc.dataSets.list.queryKey() });
	};

	const handleSubmit = () => {
		if (!editing) return;
		const trimmedLabel = editing.label.trim();
		if (trimmedLabel.length === 0) return;

		let parsedValue: unknown = undefined;
		if (editing.valueText.trim().length > 0) {
			try {
				parsedValue = JSON.parse(editing.valueText);
			} catch {
				toastError("Value isn't valid JSON. Quote strings or leave blank.");
				return;
			}
		}

		if (editing.id) {
			updateMutation.mutate(
				{
					dataSetId,
					recordId: editing.id,
					label: trimmedLabel,
					value: parsedValue,
				},
				{
					onSuccess: () => {
						invalidate();
						toastSuccess("Record updated.");
						setEditing(null);
					},
					onError: (err) => toastError(err.message ?? "Couldn't update record."),
				},
			);
		} else {
			createMutation.mutate(
				{ dataSetId, label: trimmedLabel, value: parsedValue },
				{
					onSuccess: () => {
						invalidate();
						toastSuccess("Record added.");
						setEditing(null);
					},
					onError: (err) => toastError(err.message ?? "Couldn't add record."),
				},
			);
		}
	};

	const handleDelete = (recordId: string, label: string) => {
		if (!confirm(`Delete record "${label}"? Existing run field values that reference it will still resolve, but it won't appear in pickers going forward.`)) {
			return;
		}
		deleteMutation.mutate(
			{ dataSetId, recordId },
			{
				onSuccess: () => {
					invalidate();
					toastSuccess("Record deleted.");
				},
				onError: (err) => toastError(err.message ?? "Couldn't delete record."),
			},
		);
	};

	const records = detailQuery.data?.records ?? [];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>{dataSetName} — records</DialogTitle>
					<DialogDescription>
						The values pickable from this data set. v1 record shape: a required
						label + optional structured value (JSON). Multi-field records are
						post-v1.
					</DialogDescription>
				</DialogHeader>

				<div className="mt-2 gap-3 flex flex-col">
					{detailQuery.isLoading && (
						<div className="py-8 gap-2 flex items-center justify-center text-foreground/50">
							<Spinner className="size-4" />
							<span className="text-sm">Loading records…</span>
						</div>
					)}

					{!detailQuery.isLoading && (
						<>
							<div className="flex justify-end">
								<Button
									variant="primary"
									size="sm"
									onClick={() =>
										setEditing({ id: null, label: "", valueText: "" })
									}
									disabled={editing !== null}
								>
									<Plus className="size-3.5 mr-1.5" />
									Add record
								</Button>
							</div>

							{editing && (
								<div className="px-3 py-3 rounded-md border border-border bg-muted/40 gap-3 flex flex-col">
									<p className="text-xs font-medium text-foreground/70">
										{editing.id ? "Edit record" : "New record"}
									</p>
									<div>
										<label className="text-xs font-medium mb-1 block" htmlFor="rec-label">
											Label
										</label>
										<Input
											id="rec-label"
											value={editing.label}
											onChange={(e) => setEditing({ ...editing, label: e.target.value })}
											placeholder="e.g. Studio"
											maxLength={200}
											autoFocus
											disabled={isPending}
										/>
									</div>
									<div>
										<label
											className="text-xs font-medium mb-1 block"
											htmlFor="rec-value"
										>
											Value (optional, JSON)
										</label>
										<textarea
											id="rec-value"
											value={editing.valueText}
											onChange={(e) =>
												setEditing({ ...editing, valueText: e.target.value })
											}
											placeholder='e.g. {"sqft": 400, "max_occupancy": 2}'
											rows={3}
											disabled={isPending}
											className="w-full px-3 py-2 text-sm font-mono rounded-md border border-input bg-card focus:outline-hidden focus:ring-1 focus:ring-ring"
										/>
										<p className="mt-1 text-[11px] text-foreground/50">
											Structured data the workflow may consume later (merge variables,
											conditions -- both deferred). Leave blank if the label alone is
											enough.
										</p>
									</div>
									<div className="gap-2 flex justify-end">
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setEditing(null)}
											disabled={isPending}
										>
											Cancel
										</Button>
										<Button
											variant="primary"
											size="sm"
											onClick={handleSubmit}
											disabled={editing.label.trim().length === 0 || isPending}
										>
											{isPending && <Spinner className="size-3.5 mr-1.5" />}
											{editing.id ? "Save" : "Add"}
										</Button>
									</div>
								</div>
							)}

							{records.length === 0 && !editing && (
								<div className="py-8 px-4 rounded-md border border-dashed border-border text-center text-xs text-foreground/60">
									No records yet. Click "Add record" to create the first.
								</div>
							)}

							{records.length > 0 && (
								<ul className="divide-y divide-border border border-border rounded-md overflow-hidden">
									{records.map((r) => (
										<li
											key={r.id}
											className="px-3 py-2.5 gap-3 flex items-center bg-background"
										>
											<div className="flex-1 min-w-0 gap-0.5 flex flex-col">
												<span className="font-medium text-sm truncate">{r.label}</span>
												{r.value !== undefined && r.value !== null && (
													<code className="text-[11px] text-foreground/50 font-mono truncate">
														{JSON.stringify(r.value)}
													</code>
												)}
											</div>
											<div className="gap-1 flex items-center shrink-0">
												<Button
													variant="ghost"
													size="sm"
													onClick={() =>
														setEditing({
															id: r.id,
															label: r.label,
															valueText:
																r.value === undefined
																	? ""
																	: JSON.stringify(r.value, null, 2),
														})
													}
													disabled={editing !== null || isPending}
												>
													Edit
												</Button>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => handleDelete(r.id, r.label)}
													disabled={editing !== null || isPending}
													aria-label={`Delete ${r.label}`}
												>
													<Trash2 className="size-3.5 text-destructive" />
												</Button>
											</div>
										</li>
									))}
								</ul>
							)}
						</>
					)}
				</div>

				<DialogFooter className="mt-4">
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

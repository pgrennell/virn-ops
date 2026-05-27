"use client";

// CreateAgentDialog -- name + optional description form. On submit, calls agents.create;
// the parent component handles the credential reveal (shared CredentialRevealDialog).
//
// Why split: the create + rotate flows both reveal a credential, so the reveal lives in
// its own component shared between them. This dialog stays focused on input.

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
import { toastError } from "@virn/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

interface CreateAgentDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Called after a successful create. The parent surfaces the returned plaintext
	 * credential via CredentialRevealDialog. */
	onCreated: (result: {
		id: string;
		name: string;
		plaintextCredential: string;
	}) => void;
}

export function CreateAgentDialog({ open, onOpenChange, onCreated }: CreateAgentDialogProps) {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");

	const createMutation = useMutation(orpc.agents.create.mutationOptions());

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const trimmedName = name.trim();
		if (trimmedName.length === 0) return;

		createMutation.mutate(
			{
				name: trimmedName,
				description: description.trim() || null,
			},
			{
				onSuccess: (result) => {
					queryClient.invalidateQueries({ queryKey: orpc.agents.list.queryKey() });
					onCreated({
						id: result.id,
						name: result.name,
						plaintextCredential: result.plaintextCredential,
					});
					// Reset for the next open.
					setName("");
					setDescription("");
				},
				onError: (err) => {
					// CONFLICT = duplicate name; surface inline as a toast (don't block form
					// so user can immediately edit + retry).
					toastError(err.message ?? "Couldn't create the agent.");
				},
			},
		);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (createMutation.isPending) return; // don't close mid-submit
				if (!next) {
					setName("");
					setDescription("");
					createMutation.reset();
				}
				onOpenChange(next);
			}}
		>
			<DialogContent className="max-w-md">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>Create an agent</DialogTitle>
						<DialogDescription>
							Agents are AI principals that can act on this organization's workflows via
							the MCP surface. Give it a name your team will recognize.
						</DialogDescription>
					</DialogHeader>

					<div className="mt-4 gap-4 flex flex-col">
						<div>
							<label className="text-sm font-medium mb-1.5 block" htmlFor="agent-name">
								Name
							</label>
							<Input
								id="agent-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g. Turnover AI"
								maxLength={120}
								required
								autoFocus
								disabled={createMutation.isPending}
							/>
						</div>

						<div>
							<label
								className="text-sm font-medium mb-1.5 block"
								htmlFor="agent-description"
							>
								Description{" "}
								<span className="text-foreground/50 font-normal">(optional)</span>
							</label>
							<Input
								id="agent-description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder="What this agent does"
								maxLength={2000}
								disabled={createMutation.isPending}
							/>
						</div>
					</div>

					<DialogFooter className="mt-6">
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							disabled={createMutation.isPending}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="primary"
							disabled={name.trim().length === 0 || createMutation.isPending}
						>
							{createMutation.isPending && <Spinner className="size-3.5 mr-1.5" />}
							Create agent
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

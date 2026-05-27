"use client";

// Per-row action menu for an agent: rotate credential / toggle active / soft-delete. Wraps
// the orpc mutations + propagates the rotate-credential plaintext back up to the parent so
// the shared CredentialRevealDialog can surface it.

import { Button } from "@virn/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@virn/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@virn/ui/components/dropdown-menu";
import { Spinner } from "@virn/ui/components/spinner";
import { toastError, toastSuccess } from "@virn/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreVertical, Power, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

interface AgentRowMenuProps {
	agentId: string;
	agentName: string;
	isActive: boolean;
	onCredentialRotated: (result: { agentName: string; plaintextCredential: string }) => void;
}

export function AgentRowMenu({
	agentId,
	agentName,
	isActive,
	onCredentialRotated,
}: AgentRowMenuProps) {
	const queryClient = useQueryClient();
	const [confirmRotate, setConfirmRotate] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);

	const invalidateList = () =>
		queryClient.invalidateQueries({ queryKey: orpc.agents.list.queryKey() });

	const rotateMutation = useMutation(orpc.agents.rotateCredential.mutationOptions());
	const updateMutation = useMutation(orpc.agents.update.mutationOptions());
	const deleteMutation = useMutation(orpc.agents.softDelete.mutationOptions());

	const handleRotate = () => {
		rotateMutation.mutate(
			{ id: agentId },
			{
				onSuccess: (result) => {
					invalidateList();
					setConfirmRotate(false);
					onCredentialRotated({
						agentName,
						plaintextCredential: result.plaintextCredential,
					});
				},
				onError: (err) => toastError(err.message ?? "Couldn't rotate the credential."),
			},
		);
	};

	const handleToggleActive = () => {
		updateMutation.mutate(
			{ id: agentId, isActive: !isActive },
			{
				onSuccess: () => {
					invalidateList();
					toastSuccess(isActive ? "Agent disabled." : "Agent enabled.");
				},
				onError: (err) => toastError(err.message ?? "Couldn't update the agent."),
			},
		);
	};

	const handleDelete = () => {
		deleteMutation.mutate(
			{ id: agentId },
			{
				onSuccess: () => {
					invalidateList();
					setConfirmDelete(false);
					toastSuccess("Agent deleted.");
				},
				onError: (err) => toastError(err.message ?? "Couldn't delete the agent."),
			},
		);
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						aria-label={`Actions for ${agentName}`}
						className="size-8 p-0"
					>
						<MoreVertical className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-44">
					<DropdownMenuItem onClick={() => setConfirmRotate(true)}>
						<RefreshCw className="size-3.5 mr-2" />
						Rotate credential
					</DropdownMenuItem>
					<DropdownMenuItem onClick={handleToggleActive} disabled={updateMutation.isPending}>
						<Power className="size-3.5 mr-2" />
						{isActive ? "Disable" : "Enable"}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={() => setConfirmDelete(true)}
						className="text-destructive focus:text-destructive"
					>
						<Trash2 className="size-3.5 mr-2" />
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<Dialog open={confirmRotate} onOpenChange={(v) => !rotateMutation.isPending && setConfirmRotate(v)}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>Rotate credential for "{agentName}"?</DialogTitle>
						<DialogDescription>
							This generates a new credential and immediately invalidates the existing one.
							Any system using the old credential will stop working until updated.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter className="mt-4">
						<Button variant="ghost" onClick={() => setConfirmRotate(false)} disabled={rotateMutation.isPending}>
							Cancel
						</Button>
						<Button variant="primary" onClick={handleRotate} disabled={rotateMutation.isPending}>
							{rotateMutation.isPending && <Spinner className="size-3.5 mr-1.5" />}
							Rotate credential
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={confirmDelete} onOpenChange={(v) => !deleteMutation.isPending && setConfirmDelete(v)}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>Delete "{agentName}"?</DialogTitle>
						<DialogDescription>
							The agent will be soft-deleted — it can no longer authenticate, but past
							activity remains in the audit log. This can't be undone from the UI.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter className="mt-4">
						<Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleteMutation.isPending}>
							Cancel
						</Button>
						<Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
							{deleteMutation.isPending && <Spinner className="size-3.5 mr-1.5" />}
							Delete agent
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

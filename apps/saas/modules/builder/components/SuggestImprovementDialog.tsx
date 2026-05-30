"use client";

// Phase 16 -- Suggest improvement dialog. Renders the textarea + submit
// affordance behind a Dialog so the Read view doesn't accrete more inline
// state. Calls suggestions.submit; success closes the dialog + clears
// state. Triage of the resulting open suggestion happens at
// /compliance/suggestions.

import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Button } from "@virn/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@virn/ui/components/dialog";
import { Textarea } from "@virn/ui/components/textarea";
import { useState } from "react";

interface SuggestImprovementDialogProps {
	workflowId: string;
	workflowTitle: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function SuggestImprovementDialog({
	workflowId,
	workflowTitle,
	open,
	onOpenChange,
}: SuggestImprovementDialogProps) {
	const [body, setBody] = useState("");
	const [submittedOnce, setSubmittedOnce] = useState(false);

	const submitMut = useMutation({
		...orpc.suggestions.submit.mutationOptions(),
		onSuccess: () => {
			setSubmittedOnce(true);
			setBody("");
			// Close after a short pause so the success state has a moment to
			// render. Caller is responsible for closing on cancel.
			setTimeout(() => {
				onOpenChange(false);
				setSubmittedOnce(false);
			}, 1200);
		},
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Suggest an improvement</DialogTitle>
					<DialogDescription>
						Send feedback to the team maintaining "{workflowTitle}". An admin will
						triage open suggestions and decide whether to accept / merge / reject.
					</DialogDescription>
				</DialogHeader>
				{submittedOnce && !submitMut.isError ? (
					<Alert>
						<AlertDescription>
							Thanks — your suggestion was recorded.
						</AlertDescription>
					</Alert>
				) : (
					<Textarea
						value={body}
						onChange={(e) => setBody(e.target.value)}
						placeholder="What would you change about this workflow?"
						rows={5}
						maxLength={5000}
						disabled={submitMut.isPending}
						autoFocus
					/>
				)}
				{submitMut.isError && (
					<Alert variant="error">
						<AlertDescription className="text-xs">
							{submitMut.error instanceof Error
								? submitMut.error.message
								: "Couldn't submit suggestion."}
						</AlertDescription>
					</Alert>
				)}
				<DialogFooter>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => onOpenChange(false)}
						disabled={submitMut.isPending}
					>
						Cancel
					</Button>
					<Button
						variant="primary"
						size="sm"
						onClick={() => submitMut.mutate({ workflowId, body: body.trim() })}
						disabled={submitMut.isPending || body.trim().length === 0 || submittedOnce}
					>
						{submitMut.isPending ? "Submitting…" : "Submit"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

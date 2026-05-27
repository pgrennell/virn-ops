"use client";

// CredentialRevealDialog -- the one-shot credential reveal that follows agent creation OR
// rotation. Standard service-account pattern (GitHub PAT, AWS IAM access key, Vercel token):
// shown ONCE on creation/rotation, never again -- the user is responsible for storing it.
//
// Why a dialog instead of inlining in the creation form: the credential needs to be a
// deliberate, full-attention modal so the user actually copies it before dismissing. The
// "I've stored it, close" confirm gate prevents an accidental tab-close swallowing the only
// chance to capture the plaintext.

import { Button } from "@virn/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@virn/ui/components/dialog";
import { toastSuccess } from "@virn/ui/components/toast";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { useState } from "react";

interface CredentialRevealDialogProps {
	open: boolean;
	/** The plaintext credential to display. NEVER stored anywhere on the client -- lives only
	 * in this component's render scope, gone the moment the dialog unmounts. */
	credential: string | null;
	/** The agent's display name, for the dialog heading. */
	agentName: string;
	/** Heading verb -- "created" vs "rotated" to disambiguate the create + rotate flows. */
	mode: "created" | "rotated";
	/** Fires after the user has clicked "I've stored it, close". The parent should set
	 * `open=false` and clear the credential in the same handler. */
	onConfirm: () => void;
}

export function CredentialRevealDialog({
	open,
	credential,
	agentName,
	mode,
	onConfirm,
}: CredentialRevealDialogProps) {
	const [acknowledged, setAcknowledged] = useState(false);
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		if (!credential) return;
		try {
			await navigator.clipboard.writeText(credential);
			setCopied(true);
			toastSuccess("Credential copied to clipboard.");
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard API can fail in non-secure contexts; the user can still select+copy
			// the text manually from the read-only input.
		}
	};

	if (!credential) return null;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				// Block dismissal until the user explicitly confirms via the button below.
				// Click-outside and Escape would silently swallow the only chance to copy.
				if (!next && !acknowledged) return;
				if (!next) {
					setAcknowledged(false);
					setCopied(false);
					onConfirm();
				}
			}}
		>
			<DialogContent
				onPointerDownOutside={(e) => e.preventDefault()}
				onEscapeKeyDown={(e) => e.preventDefault()}
				className="max-w-lg"
			>
				<DialogHeader>
					<DialogTitle>
						Agent {mode === "created" ? "created" : "credential rotated"}
					</DialogTitle>
					<DialogDescription>
						{mode === "created"
							? `"${agentName}" is ready to use.`
							: `"${agentName}"'s credential has been rotated.`}{" "}
						Copy the credential below — this is the only time it'll be shown.
					</DialogDescription>
				</DialogHeader>

				<div className="mt-4 p-3 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 gap-2 flex items-start">
					<AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
					<p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
						This credential won't be displayed again. Store it in your secrets manager
						now. If you lose it, you'll need to rotate the credential to generate a new one.
					</p>
				</div>

				<div className="mt-4">
					<label className="text-xs font-medium text-foreground/70 mb-1.5 block">
						Credential (one-time display)
					</label>
					<div className="gap-2 flex items-center">
						<input
							type="text"
							readOnly
							value={credential}
							onFocus={(e) => e.currentTarget.select()}
							className="flex-1 font-mono text-xs px-3 py-2 rounded-md border border-border bg-muted/50 select-all"
						/>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={handleCopy}
							aria-label="Copy credential"
						>
							{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
						</Button>
					</div>
				</div>

				<DialogFooter className="mt-4">
					<label className="gap-2 flex items-center cursor-pointer text-sm mr-auto">
						<input
							type="checkbox"
							checked={acknowledged}
							onChange={(e) => setAcknowledged(e.target.checked)}
							className="size-4"
						/>
						<span>I've stored the credential</span>
					</label>
					<Button
						type="button"
						variant="primary"
						disabled={!acknowledged}
						onClick={() => {
							setAcknowledged(false);
							setCopied(false);
							onConfirm();
						}}
					>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

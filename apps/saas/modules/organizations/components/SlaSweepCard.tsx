"use client";

// SlaSweepCard -- admin-only "Run SLA sweep now" affordance on /settings/general.
// Calls runs.runSlaSweepNow (adminOrgProcedure) which fires the sweep for the
// active org. Vercel Cron handles the platform-wide scheduled sweep hourly in
// prod; this button exists for:
//   - Dev parity: Vercel Cron doesn't fire locally, so admins dogfooding
//     escalation hit the button instead of waiting.
//   - Production manual triggers: admins who want to fire the sweep without
//     waiting for the next hourly tick.
//
// Idempotent: the sweep's audit-log antijoin filters out runs already escalated,
// so repeated clicks are safe (re-clicks just return "scanned: 0").

import { Button } from "@virn/ui/components/button";
import { SettingsItem } from "@shared/components/SettingsItem";
import { Spinner } from "@virn/ui/components/spinner";
import { toastError, toastSuccess } from "@virn/ui/components/toast";
import { useMutation } from "@tanstack/react-query";
import { Siren } from "lucide-react";

import { orpc } from "@shared/lib/orpc-query-utils";

export function SlaSweepCard() {
	const sweepMutation = useMutation(orpc.runs.runSlaSweepNow.mutationOptions());

	const handleRun = () => {
		sweepMutation.mutate(
			{},
			{
				onSuccess: (result) => {
					if (result.escalated === 0) {
						toastSuccess("Sweep complete — no overdue runs to escalate.");
					} else {
						toastSuccess(
							`Escalated ${result.escalated} ${result.escalated === 1 ? "run" : "runs"}.`,
						);
					}
				},
				onError: (err) => toastError(err.message ?? "Couldn't run the SLA sweep."),
			},
		);
	};

	return (
		<SettingsItem
			title="SLA escalation sweep"
			description="Manually fire the SLA escalation sweep for this organization. Vercel Cron runs the platform-wide sweep hourly in production; this button is the local-dev / immediate-trigger path. Idempotent — runs already escalated are skipped."
		>
			<div className="mt-4 gap-3 flex items-start justify-between">
				<div className="text-xs text-foreground/60 max-w-md leading-relaxed">
					Each overdue run gets a single <code className="font-mono">run.escalated</code>{" "}
					event in the audit log + the activity timeline. Notification + automation-action
					integration ships with Phase 18.
				</div>
				<Button
					variant="primary"
					size="sm"
					onClick={handleRun}
					disabled={sweepMutation.isPending}
					className="shrink-0"
				>
					{sweepMutation.isPending ? (
						<Spinner className="size-3.5 mr-1.5" />
					) : (
						<Siren className="size-3.5 mr-1.5" />
					)}
					Run sweep now
				</Button>
			</div>
		</SettingsItem>
	);
}

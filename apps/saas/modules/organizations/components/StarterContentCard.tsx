"use client";

// StarterContentCard -- admin-only "Install starter content" affordance on
// /settings/general (Phase 17a, BUILD_PLAN). Materializes the property-ops pack
// into the active org: 10 vendor categories + 4 workflow roles + an STR Turnover
// & Housekeeping workflow (published). Idempotent: re-clicking when already
// installed returns alreadyInstalled=true with no side effects.

import { Button } from "@virn/ui/components/button";
import { SettingsItem } from "@shared/components/SettingsItem";
import { Spinner } from "@virn/ui/components/spinner";
import { toastError, toastSuccess } from "@virn/ui/components/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Package } from "lucide-react";

import { orpc } from "@shared/lib/orpc-query-utils";

export function StarterContentCard() {
	const queryClient = useQueryClient();
	const statusQuery = useQuery(
		orpc.packs.getStarterContentStatus.queryOptions({ input: {} }),
	);
	const installMutation = useMutation(
		orpc.packs.installStarterContent.mutationOptions(),
	);

	const handleInstall = () => {
		installMutation.mutate(
			{},
			{
				onSuccess: (result) => {
					queryClient.invalidateQueries({
						queryKey: orpc.packs.getStarterContentStatus.queryKey(),
					});
					if (result.alreadyInstalled) {
						toastSuccess("Already installed -- no changes made.");
					} else {
						const parts: string[] = [];
						if (result.summary.vendorCategoriesCreated > 0) {
							parts.push(`${result.summary.vendorCategoriesCreated} vendor categories`);
						}
						if (result.summary.workflowRolesCreated > 0) {
							parts.push(`${result.summary.workflowRolesCreated} workflow roles`);
						}
						if (result.summary.workflowsCreated > 0) {
							parts.push(
								`${result.summary.workflowsCreated} ${result.summary.workflowsCreated === 1 ? "workflow" : "workflows"}`,
							);
						}
						toastSuccess(
							parts.length > 0
								? `Installed: ${parts.join(", ")}.`
								: "Installed.",
						);
					}
				},
				onError: (err) => toastError(err.message ?? "Couldn't install starter content."),
			},
		);
	};

	const status = statusQuery.data;
	const packAvailable = status?.packAvailable ?? false;
	const installed = status?.installed ?? false;
	const installedAt = status?.installedAt ?? null;

	return (
		<SettingsItem
			title="Property-ops starter content"
			description="Install the Virn property-ops pack into this organization: 10 vendor categories (pest control, HVAC, plumbing, etc.), 4 workflow roles (Property Manager, Housekeeper, Inspector, Owner), and a complete STR Turnover & Housekeeping workflow. Idempotent — clicking twice has no extra effect."
		>
			<div className="mt-4 gap-3 flex items-start justify-between">
				<div className="text-xs text-foreground/60 max-w-md leading-relaxed">
					{!packAvailable && (
						<span className="text-amber-700 dark:text-amber-400">
							Starter content isn't available for your account yet. Contact support and
							we'll get it enabled.
						</span>
					)}
					{packAvailable && installed && (
						<span className="gap-1.5 inline-flex items-center text-emerald-700 dark:text-emerald-400">
							<CheckCircle2 className="size-3.5" />
							Installed
							{installedAt && (
								<> on {new Date(installedAt).toLocaleDateString()}.</>
							)}
						</span>
					)}
					{packAvailable && !installed && (
						<>
							Adds a runnable starter workflow + vendor categories to this
							organization. Useful for dogfooding the property-ops flow end-to-end.
						</>
					)}
				</div>
				<Button
					variant="primary"
					size="sm"
					onClick={handleInstall}
					disabled={
						!packAvailable ||
						installed ||
						installMutation.isPending ||
						statusQuery.isLoading
					}
					className="shrink-0"
				>
					{installMutation.isPending ? (
						<Spinner className="size-3.5 mr-1.5" />
					) : (
						<Package className="size-3.5 mr-1.5" />
					)}
					{installed ? "Installed" : "Install starter content"}
				</Button>
			</div>
		</SettingsItem>
	);
}

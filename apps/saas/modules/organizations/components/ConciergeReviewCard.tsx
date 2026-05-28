"use client";

// ConciergeReviewCard -- admin-only toggle on /settings/general for the
// requireConciergeReview org flag (Phase 9.5g / PRD §6.6). When on, the Builder's
// Publish button becomes "Submit for review" on drafts; pending submissions land in
// /library/reviews for an admin to approve or send back.
//
// Reads the initial flag value as a prop (from server-rendered org row). After
// toggling, we DON'T optimistically update -- the server confirms before the next
// render. Toast confirms the new state.

import { Switch } from "@virn/ui/components/switch";
import { SettingsItem } from "@shared/components/SettingsItem";
import { Spinner } from "@virn/ui/components/spinner";
import { toastError, toastSuccess } from "@virn/ui/components/toast";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

interface ConciergeReviewCardProps {
	organizationSlug: string;
	initialRequireConciergeReview: boolean;
}

export function ConciergeReviewCard({
	organizationSlug,
	initialRequireConciergeReview,
}: ConciergeReviewCardProps) {
	const [enabled, setEnabled] = useState(initialRequireConciergeReview);

	const updateMutation = useMutation(
		orpc.organizations.updateConciergeReview.mutationOptions(),
	);

	const handleToggle = (next: boolean) => {
		// Optimistic update of the local toggle state -- snaps back on error.
		setEnabled(next);
		updateMutation.mutate(
			{ requireConciergeReview: next },
			{
				onSuccess: () =>
					toastSuccess(
						next
							? "Concierge review enabled. Publishes now require admin approval."
							: "Concierge review disabled. Admins can publish drafts directly.",
					),
				onError: (err) => {
					setEnabled(!next); // rollback
					toastError(err.message ?? "Couldn't update the setting.");
				},
			},
		);
	};

	return (
		<SettingsItem
			title="Concierge review"
			description="Require admin approval before any workflow draft can publish. When on, the Builder's Publish button becomes 'Submit for review'; pending submissions queue up in /library/reviews. Useful for orgs that want a four-eyes principle even though all editors are admins."
		>
			<div className="mt-4 gap-4 flex items-center justify-between">
				<div className="text-xs text-foreground/60 max-w-md leading-relaxed">
					{enabled ? (
						<>
							On — pending reviews land in{" "}
							<a
								href={`/${organizationSlug}/library/reviews`}
								className="underline hover:text-foreground"
							>
								/library/reviews
							</a>
							.
						</>
					) : (
						"Off — admins publish drafts directly with no review checkpoint."
					)}
				</div>
				<div className="gap-2 flex items-center shrink-0">
					{updateMutation.isPending && (
						<Spinner className="size-3.5 text-foreground/50" />
					)}
					<Switch
						checked={enabled}
						onCheckedChange={handleToggle}
						disabled={updateMutation.isPending}
						aria-label="Toggle concierge review"
					/>
				</div>
			</div>
		</SettingsItem>
	);
}

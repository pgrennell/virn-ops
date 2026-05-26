"use client";

// Onboarding wizard step: pick a mode for a freshly created organization. Continue calls
// applyEnablementProfile and redirects to the org dashboard. Per UX_SPEC §5.5: standalone
// (no app shell), default selection pre-applied, "change anytime in Settings" reassurance,
// no Back button (re-creating the org just made is awkward; "Skip" suggests the choice is
// throwaway). See DECISIONS.md D-014/D-015 for the related Phase 3 product calls.

import {
	type EnablementProfile,
	ModePicker,
	PROFILE_META,
} from "@organizations/components/ModePicker";
import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Button } from "@virn/ui/components/button";
import { useRouter } from "@shared/hooks/router";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

const DEFAULT_PROFILE: EnablementProfile = "checklist";

export function OnboardingModePicker({ orgSlug }: { orgSlug: string }) {
	const router = useRouter();
	const [profile, setProfile] = useState<EnablementProfile>(DEFAULT_PROFILE);
	const apply = useMutation(orpc.config.applyProfile.mutationOptions());

	const onContinue = async () => {
		try {
			await apply.mutateAsync({ profile });
			router.replace(`/${orgSlug}`);
		} catch {
			// Error is rendered below via apply.isError; stay on the page.
		}
	};

	return (
		<div className="max-w-xl mx-auto w-full">
			<div className="gap-3 flex items-center justify-between mb-6">
				<h1 className="font-bold text-xl md:text-2xl">What will you use Virn Ops for?</h1>
				<span className="text-xs shrink-0 text-foreground/60">Step 2 of 2</span>
			</div>
			<p className="mt-2 mb-6 text-foreground/60">
				This turns on the right features to get started. You can change this anytime in
				Settings → Configuration.
			</p>

			<ModePicker value={profile} onChange={setProfile} disabled={apply.isPending} />

			{apply.isError && (
				<Alert variant="error" className="mt-4">
					<AlertDescription>
						Couldn't apply {PROFILE_META[profile].name}: {apply.error.message}
					</AlertDescription>
				</Alert>
			)}

			<div className="gap-3 flex items-center justify-end mt-6">
				<Button
					type="button"
					variant="primary"
					onClick={onContinue}
					loading={apply.isPending}
				>
					Continue
				</Button>
			</div>
		</div>
	);
}

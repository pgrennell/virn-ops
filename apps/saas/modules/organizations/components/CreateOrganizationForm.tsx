"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useActiveOrganization } from "@organizations/hooks/use-active-organization";
import { organizationListQueryKey, useCreateOrganizationMutation } from "@organizations/lib/api";
import { Button } from "@virn/ui/components/button";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@virn/ui/components/form";
import { Input } from "@virn/ui/components/input";
import { toastError } from "@virn/ui/components/toast";
import { orpcClient } from "@shared/lib/orpc-client";
import { useRouter } from "@shared/hooks/router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";

const formSchema = z.object({
	name: z.string().min(3).max(32),
});

export function CreateOrganizationForm({ defaultName }: { defaultName?: string }) {
	const t = useTranslations();
	const router = useRouter();
	const queryClient = useQueryClient();
	const { setActiveOrganization } = useActiveOrganization();
	const createOrganizationMutation = useCreateOrganizationMutation();
	const form = useForm({
		resolver: zodResolver(formSchema),
		defaultValues: {
			name: defaultName ?? "",
		},
	});

	const onSubmit = form.handleSubmit(async ({ name }) => {
		try {
			const newOrganization = await createOrganizationMutation.mutateAsync({
				name,
			});

			if (!newOrganization) {
				throw new Error("Failed to create organization");
			}

			await setActiveOrganization(newOrganization.slug);

			await queryClient.invalidateQueries({
				queryKey: organizationListQueryKey,
			});

			// Phase 19: pre-install the property-ops starter content so the new org lands with
			// content instead of an empty library. BEST-EFFORT + idempotent: a failure here
			// (e.g. the platform pack isn't seeded) must NOT block org creation -- the admin can
			// still install manually via Settings -> StarterContentCard. Nested try/catch so it
			// does not fall into the outer catch (which would skip the redirect).
			try {
				await orpcClient.packs.installStarterContent({});
			} catch (err) {
				console.error("Starter-content pre-install failed (non-blocking):", err);
			}

			// Phase 19 (Option B): auto-apply the default enablement profile so a new org lands
			// ready to operate, vertical-first -- no mode-picker interstitial. "sop" is the v1
			// default: it turns on the full property-ops surface (recurring runs, kickoff forms,
			// AI steps, guest participants for vendors/cleaners, governance, custom fields) minus
			// only the advanced automation rules/webhooks. The picker now lives in Settings ->
			// Configuration as a power-user surface. BEST-EFFORT + idempotent like the pack
			// install above: a failure must NOT block the redirect (the admin can switch profiles
			// in Settings). Nested try/catch so it doesn't fall into the outer catch.
			try {
				await orpcClient.config.applyProfile({ profile: "sop" });
			} catch (err) {
				console.error("Default-profile apply failed (non-blocking):", err);
			}

			router.replace(`/${newOrganization.slug}`);
		} catch {
			toastError(t("organizations.createForm.notifications.error"));
		}
	});

	return (
		<div className="max-w-md mx-auto w-full">
			<h1 className="font-bold text-xl md:text-2xl">{t("organizations.createForm.title")}</h1>
			<p className="mt-2 mb-6 text-foreground/60">{t("organizations.createForm.subtitle")}</p>

			<Form {...form}>
				<form onSubmit={onSubmit}>
					<FormField
						control={form.control}
						name="name"
						render={({ field }) => (
							<FormItem>
								<FormLabel>{t("organizations.createForm.name")}</FormLabel>
								<FormControl>
									<Input {...field} autoComplete="email" />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>

					<Button
						className="mt-6 w-full"
						type="submit"
						variant="primary"
						loading={form.formState.isSubmitting}
					>
						{t("organizations.createForm.submit")}
					</Button>
				</form>
			</Form>
		</div>
	);
}

"use client";

import { useSession } from "@auth/hooks/use-session";
import { zodResolver } from "@hookform/resolvers/zod";
import { authClient } from "@virn/auth/client";
import { Button } from "@virn/ui/components/button";
import { Input } from "@virn/ui/components/input";
import { toastError, toastSuccess } from "@virn/ui/components/toast";
import { SettingsItem } from "@shared/components/SettingsItem";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";

const formSchema = z.object({
	name: z.string().min(3),
});

export function ChangeNameForm() {
	const { user, reloadSession } = useSession();
	const t = useTranslations();

	const form = useForm({
		resolver: zodResolver(formSchema),
		defaultValues: {
			name: user?.name ?? "",
		},
	});

	const onSubmit = form.handleSubmit(async ({ name }) => {
		const { error } = await authClient.updateUser({
			name,
		});

		if (error) {
			toastError(t("settings.account.changeName.notifications.error"));
			return;
		}

		await reloadSession();

		toastSuccess(t("settings.account.changeName.notifications.success"));

		form.reset({
			name,
		});
	});

	return (
		<SettingsItem title={t("settings.account.changeName.title")}>
			<form onSubmit={onSubmit}>
				<Input type="text" {...form.register("name")} />

				<div className="mt-4 flex justify-end">
					<Button
						type="submit"
						loading={form.formState.isSubmitting}
						disabled={!(form.formState.isValid && form.formState.dirtyFields.name)}
					>
						{t("settings.save")}
					</Button>
				</div>
			</form>
		</SettingsItem>
	);
}

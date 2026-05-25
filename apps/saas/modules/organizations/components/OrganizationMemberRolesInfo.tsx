"use client";

import { useOrganizationMemberRoleOptions } from "@organizations/hooks/member-roles";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/alert";
import { useTranslations } from "next-intl";

export function OrganizationMemberRolesInfo() {
	const t = useTranslations();
	const roleOptions = useOrganizationMemberRoleOptions();

	return (
		<Alert className="mb-4">
			<AlertTitle>{t("organizations.roles.info.title")}</AlertTitle>
			<AlertDescription>
				<p className="mb-2">{t("organizations.roles.info.description")}</p>
				<ul className="space-y-2 text-sm">
					{roleOptions.map((role) => (
						<li key={role.value}>
							<strong>{role.label}</strong>
							<span className="text-foreground/70"> — {role.description}</span>
						</li>
					))}
				</ul>
			</AlertDescription>
		</Alert>
	);
}

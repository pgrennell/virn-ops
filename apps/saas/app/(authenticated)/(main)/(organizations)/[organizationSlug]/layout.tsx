import { getSession } from "@auth/lib/server";
import { activeOrganizationQueryKey } from "@organizations/lib/api";
import { listPurchases } from "@payments/lib/server";
import { config as paymentsConfig } from "@virn/payments/config";
import { AppShell } from "@shared/components/AppShell";
import { resolveOrgGating } from "@shared/lib/gating-server";
import { orpc } from "@shared/lib/orpc-query-utils";
import { getServerQueryClient } from "@shared/lib/server";
import { SIDEBAR_COLLAPSED_COOKIE } from "@shared/lib/sidebar-context";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { PropsWithChildren } from "react";

export default async function OrganizationLayout({
	children,
	params,
}: PropsWithChildren<{
	params: Promise<{
		organizationSlug: string;
	}>;
}>) {
	const { organizationSlug } = await params;

	const session = await getSession();
	if (!session) {
		redirect("/login");
	}

	const resolved = await resolveOrgGating(organizationSlug);
	if (!resolved) {
		return notFound();
	}

	const { organization, snapshot } = resolved;
	const cookieStore = await cookies();
	const initialCollapsed = cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === "true";

	const queryClient = getServerQueryClient();

	await queryClient.prefetchQuery({
		queryKey: activeOrganizationQueryKey({ slug: organizationSlug }),
		queryFn: () => organization,
	});

	if (paymentsConfig.billingAttachedTo === "organization") {
		await queryClient.prefetchQuery({
			queryKey: orpc.payments.listPurchases.queryKey({
				input: {
					organizationId: organization.id,
				},
			}),
			queryFn: () => listPurchases(organization.id),
		});
	}

	return (
		<AppShell
			orgSlug={organizationSlug}
			snapshot={snapshot}
			role={snapshot.role}
			initialCollapsed={initialCollapsed}
		>
			{children}
		</AppShell>
	);
}

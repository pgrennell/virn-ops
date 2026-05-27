import { getActiveOrganization, getSession } from "@auth/lib/server";
import { AgentsPanel } from "@agents/components/AgentsPanel";
import { isOrganizationAdmin } from "@virn/auth/lib/helper";
import { PageHeader } from "@shared/components/PageHeader";
import { notFound, redirect } from "next/navigation";

export const metadata = {
	title: "Agents",
};

// /settings/agents -- admin/owner-only org-scoped agent management (Phase 8 step 2, ADR-006
// + D-022). Non-admin members are redirected to /settings/general -- the agents.* mutation
// procedures gate at the API layer too (defense in depth), but redirecting at the route
// level avoids dead UI for non-admins.

export default async function OrganizationAgentsPage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const session = await getSession();
	const { organizationSlug } = await params;
	const organization = await getActiveOrganization(organizationSlug);

	if (!organization) {
		return notFound();
	}

	if (!isOrganizationAdmin(organization, session?.user)) {
		return redirect(`/${organizationSlug}/settings/general`);
	}

	return (
		<>
			<PageHeader
				title="Agents"
				subtitle="Manage AI principals that can act on this organization via the MCP surface."
			/>
			<AgentsPanel />
		</>
	);
}

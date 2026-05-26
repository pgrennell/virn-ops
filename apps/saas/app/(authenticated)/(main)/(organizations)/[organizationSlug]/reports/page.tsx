import { PlaceholderScreen } from "@shared/components/PlaceholderScreen";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const metadata = { title: "Reports" };

export default async function ReportsPage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;
	await assertCanSee(organizationSlug, NAV_AREAS.reports);

	return (
		<PlaceholderScreen
			title="Reports"
			subtitle="Run + step analytics, saved views, BI."
			phase="defer-design"
		/>
	);
}

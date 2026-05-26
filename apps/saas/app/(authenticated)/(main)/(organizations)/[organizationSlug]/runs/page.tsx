import { PlaceholderScreen } from "@shared/components/PlaceholderScreen";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const metadata = { title: "Runs" };

export default async function RunsPage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;
	await assertCanSee(organizationSlug, NAV_AREAS.runs);

	return (
		<PlaceholderScreen
			title="Runs"
			subtitle="The execution surface — steps, fields, assignees, due dates, progress, stop-task gating."
			phase="defer-design"
		/>
	);
}

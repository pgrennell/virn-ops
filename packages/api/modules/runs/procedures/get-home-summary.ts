import { getHomeCountsForUser } from "@virn/database";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const getHomeSummaryProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/runs/home-summary",
		tags: ["Runs"],
		summary: "Dashboard counts for the active org + current user",
		description:
			"Returns open task count, due-today / overdue, active run count, and approvals pending on me. Counts only -- no rows.",
	})
	.handler(async ({ context }) => {
		const counts = await getHomeCountsForUser({
			organizationId: context.organization.id,
			userId: context.user.id,
			now: new Date(),
		});
		// approvalsPendingCount is a placeholder until the approval flow lands; surface as 0
		// to keep the UI contract stable.
		return {
			...counts,
			approvalsPendingCount: 0,
		};
	});

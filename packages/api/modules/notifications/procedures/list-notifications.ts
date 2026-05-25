import { resolveNotificationLink, listNotificationRowsForUser } from "@repo/notifications";
import { z } from "zod";

import { protectedProcedure } from "../../../orpc/procedures";

export const listNotifications = protectedProcedure
	.route({
		method: "GET",
		path: "/notifications",
		tags: ["Notifications"],
		summary: "List notifications",
		description: "Returns recent notifications for the current user",
	})
	.input(
		z.object({
			take: z.number().int().min(1).max(100).optional(),
		}),
	)
	.handler(async ({ input: { take }, context: { user } }) => {
		const rows = await listNotificationRowsForUser(user.id, take ?? 50);
		const items = rows.map((row) => ({
			...row,
			link: resolveNotificationLink(row.link),
		}));
		return items.map((n) => ({
			id: n.id,
			userId: n.userId,
			type: n.type as string,
			data: n.data,
			link: n.link,
			read: n.read,
			createdAt: n.createdAt,
			updatedAt: n.updatedAt,
		}));
	});

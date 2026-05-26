import { NotificationTarget, NotificationType } from "@virn/database";
import { setNotificationDisabled } from "@virn/notifications";
import { z } from "zod";

import { protectedProcedure } from "../../../orpc/procedures";

// Derived from the canonical const-objects in @virn/database (mirrored from the
// pgEnum). Adding a new notification type there automatically expands this schema
// — no more hand-maintained subset that rots when the DB enum grows.
type NotificationTypeValue = (typeof NotificationType)[keyof typeof NotificationType];
type NotificationTargetValue = (typeof NotificationTarget)[keyof typeof NotificationTarget];

const notificationTypeSchema = z.enum(
	Object.values(NotificationType) as [NotificationTypeValue, ...NotificationTypeValue[]],
);
const notificationTargetSchema = z.enum(
	Object.values(NotificationTarget) as [NotificationTargetValue, ...NotificationTargetValue[]],
);

export const updatePreference = protectedProcedure
	.route({
		method: "PUT",
		path: "/notifications/preferences",
		tags: ["Notifications"],
		summary: "Update a notification preference",
	})
	.input(
		z.object({
			type: notificationTypeSchema,
			target: notificationTargetSchema,
			disabled: z.boolean(),
		}),
	)
	.handler(async ({ input: { type, target, disabled }, context: { user } }) => {
		await setNotificationDisabled(user.id, type, target, disabled);
		return { ok: true as const };
	});

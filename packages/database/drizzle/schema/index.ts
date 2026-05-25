export * from "./postgres";

export const NotificationTarget = {
	IN_APP: "IN_APP",
	EMAIL: "EMAIL",
} as const;

export type NotificationTarget = (typeof NotificationTarget)[keyof typeof NotificationTarget];

export const NotificationType = {
	WELCOME: "WELCOME",
	APP_UPDATE: "APP_UPDATE",
	RUN_ASSIGNED: "RUN_ASSIGNED",
	RUN_COMPLETED: "RUN_COMPLETED",
	STEP_ASSIGNED: "STEP_ASSIGNED",
	STEP_COMPLETED: "STEP_COMPLETED",
	STEP_OVERDUE: "STEP_OVERDUE",
	APPROVAL_REQUESTED: "APPROVAL_REQUESTED",
	APPROVAL_DECIDED: "APPROVAL_DECIDED",
	ACKNOWLEDGMENT_DUE: "ACKNOWLEDGMENT_DUE",
	SUGGESTION_RESOLVED: "SUGGESTION_RESOLVED",
	COMMENT_MENTION: "COMMENT_MENTION",
} as const;

export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

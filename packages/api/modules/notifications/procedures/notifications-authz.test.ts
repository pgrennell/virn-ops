// Coverage hardening -- the notifications module had ZERO test coverage. All six
// procedures are protectedProcedure (user-scoped, not org-scoped). The security
// property worth pinning is OWNERSHIP SCOPING: every procedure forwards the
// caller's session user.id to its query -- there is no userId in any input schema,
// so a caller can only ever list/mutate their OWN notifications. Plus: no session
// -> UNAUTHORIZED. Mocks @virn/auth + @virn/notifications (all helpers) and the two
// enum const-objects from @virn/database.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

vi.mock("@virn/notifications", () => ({
	resolveNotificationLink: vi.fn(() => null),
	listNotificationRowsForUser: vi.fn(),
	countUnreadNotificationsForUser: vi.fn(),
	markNotificationsAsRead: vi.fn(),
	markAllNotificationsAsReadForUser: vi.fn(),
	getDisabledNotificationPreferences: vi.fn(),
	setNotificationDisabled: vi.fn(),
}));

// update-preference builds its zod input from these const-objects at module load,
// so they must be non-empty objects (z.enum(Object.values(...))).
vi.mock("@virn/database", () => ({
	NotificationType: { APP_UPDATE: "APP_UPDATE" },
	NotificationTarget: { IN_APP: "IN_APP" },
}));

import { auth } from "@virn/auth";
import {
	countUnreadNotificationsForUser,
	getDisabledNotificationPreferences,
	listNotificationRowsForUser,
	markAllNotificationsAsReadForUser,
	markNotificationsAsRead,
	setNotificationDisabled,
} from "@virn/notifications";

import { getPreferences } from "./get-preferences";
import { listNotifications } from "./list-notifications";
import { markAllNotificationsRead } from "./mark-all-read";
import { markNotificationsRead } from "./mark-notifications-read";
import { unreadCount } from "./unread-count";
import { updatePreference } from "./update-preference";

const ctx = { context: { headers: new Headers() } };

function makeSession(userId = "user-1") {
	return {
		user: { id: userId, email: "u@example.com", name: "U", emailVerified: true },
		session: { id: "session-1", userId, token: "tok", expiresAt: new Date() },
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
	vi.mocked(listNotificationRowsForUser).mockResolvedValue([] as never);
	vi.mocked(countUnreadNotificationsForUser).mockResolvedValue(0 as never);
	vi.mocked(markNotificationsAsRead).mockResolvedValue({ count: 0 } as never);
	vi.mocked(markAllNotificationsAsReadForUser).mockResolvedValue({ count: 0 } as never);
	vi.mocked(getDisabledNotificationPreferences).mockResolvedValue([] as never);
	vi.mocked(setNotificationDisabled).mockResolvedValue(undefined as never);
});

describe("notifications -- ownership scoping (caller's session user.id only)", () => {
	it("list forwards the caller's session user id", async () => {
		await call(listNotifications, {}, ctx);
		expect(listNotificationRowsForUser).toHaveBeenCalledWith("user-1", expect.anything());
	});

	it("unreadCount forwards the caller's session user id", async () => {
		await call(unreadCount, {}, ctx);
		expect(countUnreadNotificationsForUser).toHaveBeenCalledWith("user-1");
	});

	it("markRead forwards the caller's user id + the input ids (no userId from input)", async () => {
		await call(markNotificationsRead, { ids: ["n1", "n2"] }, ctx);
		expect(markNotificationsAsRead).toHaveBeenCalledWith("user-1", ["n1", "n2"]);
	});

	it("markAllRead forwards the caller's session user id", async () => {
		await call(markAllNotificationsRead, {}, ctx);
		expect(markAllNotificationsAsReadForUser).toHaveBeenCalledWith("user-1");
	});

	it("getPreferences forwards the caller's session user id", async () => {
		await call(getPreferences, {}, ctx);
		expect(getDisabledNotificationPreferences).toHaveBeenCalledWith("user-1");
	});

	it("updatePreference forwards the caller's session user id", async () => {
		await call(updatePreference, { type: "APP_UPDATE", target: "IN_APP", disabled: true }, ctx);
		expect(setNotificationDisabled).toHaveBeenCalledWith("user-1", "APP_UPDATE", "IN_APP", true);
	});

	it("a different caller scopes to THEIR id (no cross-user leakage)", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(makeSession("user-2") as never);
		await call(listNotifications, {}, ctx);
		expect(listNotificationRowsForUser).toHaveBeenCalledWith("user-2", expect.anything());
	});
});

describe("notifications -- unauthenticated", () => {
	const procs: Array<{ name: string; run: () => Promise<unknown> }> = [
		{ name: "list", run: () => call(listNotifications, {}, ctx) },
		{ name: "unreadCount", run: () => call(unreadCount, {}, ctx) },
		{ name: "markRead", run: () => call(markNotificationsRead, { ids: ["n1"] }, ctx) },
		{ name: "markAllRead", run: () => call(markAllNotificationsRead, {}, ctx) },
		{ name: "getPreferences", run: () => call(getPreferences, {}, ctx) },
		{ name: "updatePreference", run: () => call(updatePreference, { type: "APP_UPDATE", target: "IN_APP", disabled: true }, ctx) },
	];

	for (const p of procs) {
		it(`${p.name} throws UNAUTHORIZED with no session`, async () => {
			vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
			await expect(p.run()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		});
	}
});

// packages/database/drizzle/schema/rbac.ts
//
// Custom roles + ACLs + groups (ARCHITECTURE.md ADR-004). Layered ON TOP of Better Auth's
// org roles (owner / admin / member, in `member.role`): Better Auth's role gates app-level
// permissions, our `role_assignment` rows add finer-grained grants per org. `permission` is
// a platform-global catalog (no orgId); `role`, `group`, `group_member`, and
// `role_assignment` are tenant-owned.
//
// MVP scope (per ADR-004): custom roles, basic ACL check, groups. Reserved for later: ABAC,
// hard domain separation, multi-level business-unit hierarchy.

import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
} from "drizzle-orm/pg-core";
import { id, orgId, timestamps, user } from "./_shared";

export const permissionScope = pgEnum("permission_scope", [
  "own", // resources owned by the actor
  "team", // resources owned by groups the actor belongs to
  "org", // any resource in the actor's organization
  "platform", // platform-admin only
]);

// Platform-global catalog. Permission rows are seeded; not tenant-mutable.
// resourceType + action together name what's being authorized (e.g. "workflow",
// "publish"); scope is the breadth the holder may act over.
export const permission = pgTable(
  "permission",
  {
    id: id(),
    resourceType: text("resource_type").notNull(),
    action: text("action").notNull(),
    scope: permissionScope("scope").notNull(),
    description: text("description"),
    ...timestamps,
  },
  (t) => [
    unique("uq_permission_resource_action_scope").on(
      t.resourceType,
      t.action,
      t.scope,
    ),
  ],
);

// Custom org-scoped roles, layered on Better Auth `member.role`. `key` is the stable
// identifier referenced by application code / pack manifests. `isSystem` distinguishes
// pack-seeded vs. org-customized roles (pack-seeded should not be deleted by tenants).
export const role = pgTable(
  "role",
  {
    id: id(),
    organizationId: orgId(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: text("is_system"), // null = user-defined; non-null = source identifier (e.g. pack slug)
    ...timestamps,
  },
  (t) => [
    unique("uq_role_org_key").on(t.organizationId, t.key),
    index("idx_role_org").on(t.organizationId),
  ],
);

// Many-to-many: a role grants a set of permissions.
export const rolePermission = pgTable(
  "role_permission",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => role.id, { onDelete: "cascade" }),
    permissionId: text("permission_id")
      .notNull()
      .references(() => permission.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const group = pgTable(
  "group",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    description: text("description"),
    ...timestamps,
  },
  (t) => [index("idx_group_org").on(t.organizationId)],
);

export const groupMember = pgTable(
  "group_member",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

// Assignment of a role to a principal. The principal is either a user OR a group — exactly
// one (CHECK constraint, same pattern as `participant.userId`/`guestEmail` in runs.ts).
export const roleAssignment = pgTable(
  "role_assignment",
  {
    id: id(),
    organizationId: orgId(),
    roleId: text("role_id")
      .notNull()
      .references(() => role.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    groupId: text("group_id").references(() => group.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [
    check(
      "role_assignment_principal",
      sql`(${t.userId} is not null) <> (${t.groupId} is not null)`,
    ),
    index("idx_role_assignment_org").on(t.organizationId),
    index("idx_role_assignment_role").on(t.roleId),
    index("idx_role_assignment_user").on(t.userId),
    index("idx_role_assignment_group").on(t.groupId),
  ],
);

export const permissionRelations = relations(permission, ({ many }) => ({
  rolePermissions: many(rolePermission),
}));

export const roleRelations = relations(role, ({ many }) => ({
  rolePermissions: many(rolePermission),
  assignments: many(roleAssignment),
}));

export const rolePermissionRelations = relations(rolePermission, ({ one }) => ({
  role: one(role, { fields: [rolePermission.roleId], references: [role.id] }),
  permission: one(permission, {
    fields: [rolePermission.permissionId],
    references: [permission.id],
  }),
}));

export const groupRelations = relations(group, ({ many }) => ({
  members: many(groupMember),
  assignments: many(roleAssignment),
}));

export const groupMemberRelations = relations(groupMember, ({ one }) => ({
  group: one(group, { fields: [groupMember.groupId], references: [group.id] }),
  user: one(user, { fields: [groupMember.userId], references: [user.id] }),
}));

export const roleAssignmentRelations = relations(roleAssignment, ({ one }) => ({
  role: one(role, {
    fields: [roleAssignment.roleId],
    references: [role.id],
  }),
  user: one(user, {
    fields: [roleAssignment.userId],
    references: [user.id],
  }),
  group: one(group, {
    fields: [roleAssignment.groupId],
    references: [group.id],
  }),
}));

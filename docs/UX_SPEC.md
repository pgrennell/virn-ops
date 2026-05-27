# UX_SPEC.md

UI/UX and navigation specification for Virn Ops.

**Status:** Draft v1 · **Date:** 2026-05-25 · **Owner:** Paul

> **For AI agents (Claude Code, etc.):** Build screens from this spec. Two hard rules:
> (1) every screen and nav item is gated by the **capability × role** model in §2 — wire it
> through the config resolver (see Configuration.md) and the role/ACL layer (ADR-004), never
> ad hoc per screen; (2) the **operator** screens in §5 are designed but deferred in the build
> order — build the admin + builder set first, keeping the operator nav slots reachable by admins.
> The wireframes in `docs/wireframes/` are
> **visual reference only** — this spec is normative, and production styling comes from the
> `frontend-design` skill, not the mockup markup. Decisions land in `DECISIONS.md` (the repo's
> running log); §6 mirrors the UX-relevant ones. Data-model entities referenced here live in
> `packages/database/drizzle/schema/` and ARCHITECTURE.md.

---

## 1. Scope & principles

- **End goal:** balanced for builders and operators. **Current focus:** admin + builder screens.
  Operator screens are deferred but reachable by admins for testing.
- **Synthesis, not copy.** Best of Manifestly (recurring runs), Process Street (unified
  library + My Work), SweetProcess (SOP/policy reading & governance), Tallyfy (process builder
  + automation). The result is one coherent IA, not any single tool reproduced.
- **Aesthetic:** flat, clean, generous whitespace, native-feeling B2B SaaS. Sentence case
  throughout. Tokens come from the `frontend-design` skill at build time.
- **Wireframes:** static mockups, one HTML file per screen, in `docs/wireframes/`. Linked from
  each screen spec below. Reference only — not production markup.

---

## 2. The gating model (two axes)

Every nav item and screen is gated on two independent axes and appears only when **both** pass:

```
visible = capabilityEnabled(org)  ∧  permitted(user)
```

- **Capability** — is the feature on for this org? Resolved by the L1/L2/L3 config resolver
  (Configuration.md). A disabled capability removes the area for *everyone* in the org.
- **Permission** — may this user reach it? Resolved by role / ACL (ADR-004).

**Admin / Owner is a superset:** it bypasses the permission axis and sees every
capability-enabled area, including operator screens, for oversight and testing. A **"View as
role"** switcher is reserved (lets an admin preview a Builder/Operator view without logging out).

This is the spine of the whole product — Configuration (capabilities) and Members & Roles
(permissions) are the two halves of access control, and they are designed to be read together.

---

## 3. App shell & navigation (IA)

**Global chrome.** Left sidebar (grouped, persistent) + top bar: global search (⌘K), a primary
**+ Create**, notifications/inbox, org switcher, and the role/account menu (carries the Admin
"all access" indicator).

**Routing.** `<product>.virn.com/[orgSlug]/…` — tenant resolved from the org slug in the path.

**Nav groups** (visibility = role ∧ capability):

| Group | Items | Typical roles | Phase |
|---|---|---|---|
| Operate | Home · My work · Runs | Operator, Admin (Builder monitors) | `[DESIGNED · build deferred]` |
| Build | Library · Templates · Automations¹ | Builder, Admin | `[NOW]` |
| Understand | Reports | Builder, Admin | `[DEFER]` |
| Admin | Settings → Configuration · Members & roles · Branding · Integrations¹ · Billing · Org general | Admin/Owner | `[NOW]` |

¹ Automations and Integrations are gated by the automation/integrations capability.

---

## 4. Screen specs — admin + builder `[NOW]`

Each spec: purpose · layout · key elements · states · gating · MVP cut · data ties.

### 4.1 Configuration (admin) — the three levels

**Wireframe:** [wireframes/01-configuration.html](wireframes/01-configuration.html)

- **Purpose.** The org admin sets a mode, then fine-tunes features. This is the UI form of the
  L1→L2→L3 config model (Configuration.md).
- **Layout.** Single page, three stacked sections: **Mode**, **Capabilities**, **Settings**.
- **Mode (L2 — enablement profile).** Card picker: Checklist / SOP / Automation. One marked
  Current. Selecting bulk-applies the profile. Inline warning: *switching mode resets
  mode-managed features; overrides outside the mode are kept* (gotcha #1).
- **Capabilities (L3).** Grouped feature toggles. Each row carries a provenance badge —
  `Default` / `From mode` / `Overridden` — and overridden rows show a one-click **Reset**.
  Toggling writes an `organization_capability` row.
- **Settings (L3).** Typed inputs grouped by category. A setting whose gating capability is off
  is **hidden, not greyed** (resolver filters it out). Each shows its value, validates on save
  (`validateSettingValue`), and offers reset-to-default. Universal settings (`capabilityId` null)
  always show.
- **Gating.** Admin/Owner only. L1 platform defaults are NOT shown here — that's a separate
  platform-admin surface.
- **MVP cut.** Mode picker + Capabilities + the universal/governance settings. Advanced settings
  categories grow over time.
- **Data ties.** `capability`, `setting_definition`, `organization_capability`,
  `organization_setting`; resolver in `queries/config.ts`.

### 4.2 Library (build)

**Wireframe:** [wireframes/02-library.html](wireframes/02-library.html)

- **Purpose.** The builder's home — all authored, reusable content in one place.
- **Key decision — one library, many types.** Backed by the single `workflow` table with a
  `type` discriminator (`procedure | document | policy | form`); you filter by type, not navigate
  to separate apps.
- **Layout.** Folder rail (left, inside the content area) + main panel: type tabs
  (All / Workflows / SOPs / Forms) → search + sort toolbar → item list.
- **Organize & find — three independent axes.** Folders (hierarchical), tags (cross-cutting),
  full-text search. Status filter (Draft/Published/Archived), owner filter.
- **Item rows are type-aware.** Shared row shape, type-specific metadata + primary action:
  published workflow → run count + **Run** (snapshots the published version, invariant #3);
  published SOP → version + review-due + **Open**; any draft → **Edit**. Status badge mirrors
  `workflow_version.status`.
- **Create.** One **+ Create** menu: Workflow / SOP or Policy / Form / Import from template
  (deep-clones from the Templates gallery into the current folder).
- **Gating.** SOPs tab needs the documents capability; Forms needs forms; per-item "Publish to
  template library" needs public-listings; create/edit needs builder permission; archive/delete
  needs more.
- **MVP cut.** Workflows + SOPs tabs, folders (light), tags, search, status filter, list view.
  Forms, grid view, and saved/multi-filter views later.
- **Confirmed decision.** Per-row action varies by type + status; folders/tags/status are
  independent axes; list view ships first.

### 4.3 Workflow Builder (build)

**Wireframes:** [wireframes/03-workflow-builder-canvas.html](wireframes/03-workflow-builder-canvas.html)
· [wireframes/04-workflow-builder-config-panel.html](wireframes/04-workflow-builder-config-panel.html)

- **Purpose.** Author a procedure as `section → step → field`, producing a versioned draft you
  publish; runs snapshot the published version.
- **Layout — two regions + a panel.** Left **outline** (kickoff form + sections + steps, drag
  reorder, type icons) is the spine; center **step editor** (name, instructions, that step's
  fields) is the focus; a **configuration panel** slides in for per-step/per-field detail so the
  canvas stays readable.
- **Step types.** `task | approval | heading | one-off` (reserve `code | ai`). Type changes the
  settings a step exposes; icons differentiate in the outline.
- **The stable field key (critical).** Each field has a friendly label + an immutable `key`,
  shown as a monospace chip. Confirmed lifecycle: auto-slug from the label → editable until first
  referenced → **locked** thereafter (merge variables, conditions, automations reference the key,
  invariant #5).
- **Field types & homes.** Text/number/date/select/multiselect/checkbox/file/member, etc. Fields
  live on a step OR on the kickoff form (`stepId` null — collected at run start).
- **Assignment by role.** Steps target a `workflowRole` ("IT", "Reviewer"), resolved to people at
  run time (`run_role_assignment`) — keeps templates reusable.
- **Due rules.** Per-step `due_type`: none / offset from run start / offset from another step /
  from a date field.
- **Logic — inline.** Confirmed: per-step conditions ("Show when `key` op value") and stop-tasks
  ("Blocked by — can't complete until step X", `step_dependency`) live **on the step**. The
  Automations screen is reserved for cross-workflow rules. Both consume the general automation
  engine (ADR-003).
- **Versioning = publish.** Always edit a draft; **Publish** mints a `workflow_version`; runs
  snapshot it; editing the draft never disturbs in-flight runs (invariants #3, #4). The top bar
  always shows draft-vs-published state. **Preview** is a no-side-effect dry render — the
  canvas paints the draft through the same operator primitives without creating a run or
  any side effect (D-019; verifying real-run behavior happens via Library → Run).
- **Capability-shaped palette.** Approval steps need governance.approvals; conditions/stop-tasks
  need automation; guest assignees need guests; advanced field types need custom-fields. The
  builder an org sees matches the mode it chose in Configuration.
- **MVP cut.** Sections + task/heading steps, fields with keys (core types), role assignment,
  due offset-from-start, draft/publish, kickoff form. Approval steps, conditions, stop-tasks,
  other due types, advanced field types, and preview-run come later.

### 4.4 Members & Roles (admin)

**Wireframe:** [wireframes/05-members-and-roles.html](wireframes/05-members-and-roles.html)

- **Purpose.** Manage who's in the org and what each role may reach — the permission half of the
  gating model (§2).
- **Layout.** Two tabs: **Members** (people) and **Roles** (definitions).
- **Members tab.** Table: avatar, name, email, role, status (invited/active), last active, ⋯.
  Invite by email → assign role; change role inline; remove (can't remove the last owner).
- **Roles tab.** Built-in Owner + Admin (not deletable) plus custom roles. Role list (with member
  counts) + a permission editor for the selected role.
- **Permissions map to nav areas.** The editor is organized by the Operate / Build / Understand /
  Admin groups, so "what a role can do" reads as "which sections it sees." Confirmed: area-level
  access (Run & view / Full access / View only / No access) is the primary UI, expandable to
  per-action (view / create / edit / delete) for finer grain.
- **Preset roles (confirmed).** Owner, Admin, Builder, Operator, Reviewer.
- **Composes with capabilities.** Effective access = permission ∩ org capability; features the
  org hasn't enabled don't appear for any role. The screen links back to Configuration.
- **MVP cut.** Members table + invite + role assignment + the preset custom roles with the
  area-level editor. Groups, resource-level ACLs, and ABAC are reserved (ADR-004).

---

## 5. Operator screens `[DESIGNED · build deferred]`

Designed; build comes after the admin + builder set (they need the run engine, Phase 3). Admins
can reach them now for testing. These are the runtime mirror of the build screens.

### 5.1 Home — bridge dashboard

**Wireframe:** [wireframes/06-home.html](wireframes/06-home.html)

- **Purpose.** The balanced landing — task-forward for operators, with run + approval context for
  builders/admins. Role- and capability-aware: operators get a task view; builders/admins also get
  a governance/build pulse; the "Awaiting you" approvals card only shows if approvals is on.
- **Layout.** Greeting + Start-a-run; a stat row (open tasks / due today / overdue / active runs);
  two columns — My tasks (upcoming + overdue, quick-complete, "View all" → My work) and a right
  rail (Awaiting you = approvals/acknowledgments pending on me; Active runs with progress).
- **Data ties.** The user's `run_step` assignments, the runs they're in, pending approvals.
- **MVP cut.** Tasks + active runs + stats. Build pulse and approvals card with their features.

### 5.2 My work — task inbox

**Wireframe:** [wireframes/07-my-work.html](wireframes/07-my-work.html)

- **Purpose.** Every task (`run_step`) assigned to me across all runs — the screen operators live in.
- **Layout.** To do / Completed tabs + group-by (due / run) + filter; list grouped by due bucket
  (Overdue / Today / This week / Later). Rows: complete checkbox, task name, run · workflow
  context, due. A task gated by an unfinished stop-task shows as **blocked**, not completable.
- **Gesture.** Quick-complete inline; open a task to fill its fields (or jump into the Run view at
  that step).
- **Data ties.** `run_step` where the assignee resolves to me (direct or via run role assignment).
- **MVP cut.** Grouped list + complete + open. Saved filters and by-run grouping later.

### 5.3 Run / Checklist view — execution surface

**Wireframe:** [wireframes/08-run-view.html](wireframes/08-run-view.html)

- **Purpose.** Execute one run — the runtime counterpart to the Workflow Builder canvas.
- **Layout.** Header (run name · subject, source workflow, status, progress bar X/Y, due, started);
  left step list with completion (done = checked, current = active, blocked = locked) and type
  icons; center = active step with instructions + **live** input fields, assignee/due, a Complete
  action, and comments/activity.
- **Execution semantics.** The run is a snapshot of a published version (editing the template never
  changes a run in flight — invariants #3/#4); required fields must be filled to complete a step;
  stop-tasks block completion until their dependency is done; conditions hide non-applicable
  steps/fields. You act only on steps assigned to you (others read-only); admins see all; builders
  reach a version of this via Preview.
- **Data ties.** `run`, `run_step`, `field_value`, `participant`, `step_dependency`,
  `run_role_assignment`.
- **MVP cut.** Step list + live fields + complete + progress. Comments/activity and full
  condition/stop-task enforcement land with the run engine.

### 5.4 Guest run view

**Wireframe:** [wireframes/09-guest-run-view.html](wireframes/09-guest-run-view.html)

- **Purpose.** A focused, no-nav portal for an external `participant` (a guest email, not an org
  member) to complete only their assigned step(s) in one run.
- **Layout.** Standalone branded page — no app shell. Org branding header; a one-line "who asked
  and why" + due; the assigned step(s) with live fields; Submit. A subtle "Powered by Virn Ops"
  footer (hidden on the white-label tier).
- **Scope/safety.** The guest sees only their assigned steps/fields and minimal run context —
  never the Library, other runs, or org data. Access is via a tokenized participant link, not a
  full account.
- **Data ties.** `participant` (guest), the `run_step`/fields assigned to them, `field_value`
  writes on submit.
- **MVP cut.** Single run, assigned steps, submit. Deferred until the guests capability + run engine.

### 5.5 Onboarding — mode picker

**Wireframe:** [wireframes/10-onboarding-mode-picker.html](wireframes/10-onboarding-mode-picker.html)

- **Purpose.** The final step of create-org — pick a mode, which applies the L2 enablement profile,
  tailoring which features are on from the first screen and introducing the customization model
  early.
- **Layout.** Onboarding wizard step — no app shell. Step indicator; "What will you use Virn Ops
  for?"; the three modes (Checklist / SOP / Automation) as selectable options with plain-language
  descriptions; Back / Continue; reassurance "you can change this anytime in Settings →
  Configuration." A sensible default is pre-selected.
- **Behavior.** Selecting + Continue calls `applyEnablementProfile` for the new org and lands them
  in the app with the right features on. Same three profiles as the Configuration mode picker —
  this is the friendly front door to that system.
- **MVP cut.** Yes — it's the earliest, highest-leverage customization touchpoint.

---

## 6. Confirmed decisions (UX subset)

> The repo's running decision log is `DECISIONS.md`; the entries below are the UX-relevant ones,
> mirrored here for screen-build context. Keep both in sync when a decision changes.

1. Nav grouped Operate / Build / Understand / Admin; gating = capability ∧ permission; Admin is a
   superset that can reach operator screens for testing; "View as role" reserved.
2. Library is one store over `workflow.type`; per-row action varies by type + status
   (Run / Open / Edit); folders, tags, status are independent axes; list view first.
3. Builder field keys auto-slug → editable until first referenced → locked; conditions and
   stop-tasks live inline on the step; Automations screen is for cross-workflow rules.
4. Members & Roles uses area-level permissions (expandable to per-action later); preset roles
   Owner / Admin / Builder / Operator / Reviewer.
5. Configuration surfaces L2 (mode) + L3 (capabilities, settings); settings hidden when their
   gating capability is off; provenance badges Default / From mode / Overridden with reset.

---

## 7. Cross-cutting patterns

- **Status badges.** Draft / Published / Archived everywhere a `workflow_version` status is shown.
- **+ Create menu.** Single primary action with a type menu; "Import from template" routes to
  Templates and deep-clones back.
- **Configuration panel / drawer.** Dense per-item settings (builder field/step config, etc.) go
  in a right-slide panel, not on the canvas.
- **Provenance badges.** Anywhere a value can come from default vs mode vs user override, show
  which and offer reset.
- **Gating helper.** A single `canSee(area)` / `isEnabled(capability)` utility pair drives nav and
  in-screen affordances; never reimplement per feature.
- **Empty states.** Every list screen needs a first-run empty state that points at + Create or
  Import from template.

---

## 8. Build-order tie-in

UI is BUILD_PLAN Phase 5, on top of the config system (Phase 2), run engine (Phase 3), and oRPC
(Phase 4). Within the UI phase, build in this order: app shell + gating helper → Configuration →
Members & Roles → Library → Workflow Builder. Operator screens follow once the run engine UI is
needed.

---

## 9. Open / reserved

- All screens now specified (admin, builder, operator, guest, onboarding) — next is implementation.
- Library grid view + saved/multi-filter views.
- Granular per-action permission matrix UI (area-level ships first).
- Branding / white-label settings screen (premium tier; see BRANDING.md).
- Reports / analytics screens.
- "View as role" admin preview switcher.

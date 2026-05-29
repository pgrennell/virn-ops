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

- **End goal:** balanced for builders and operators. Post-pivot (D-021), **both admin/builder
  and operator screens are in v1 scope** — vertical-first (property ops) launch requires
  execution surfaces, not just authoring. The operator screens in §5 are no longer "build
  deferred."
- **Coherent IA, vertical-anchored.** The information architecture synthesizes the
  data-shape lessons of the original four reference products (Manifestly recurring runs,
  Process Street library + My Work, SweetProcess SOP governance, Tallyfy guest model +
  inline conditions — see STRATEGY Appendix A for the historical analysis), but the v1
  product story is **one authored procedure → three execution modes** (STRATEGY S-07).
  Screens reflect that wedge: every run launch carries a mode (`human | ai_assisted |
  automated`); the Run view shows where agents act and where humans take over.
- **Aesthetic:** flat, clean, generous whitespace, native-feeling B2B SaaS. Sentence case
  throughout. Tokens come from the `frontend-design` skill at build time.
- **Wireframes:** static mockups, one HTML file per screen, in `docs/wireframes/`. Linked from
  each screen spec below. Reference only — not production markup. Existing wireframes
  predate the pivot; refresh as each screen is built to reflect mode-aware launch + run
  surfaces.

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
| Operate | Home · My work · Runs | Operator, Admin (Builder monitors) | `[NOW · v1 per D-021]` |
| Build | Library · Templates · Automations¹ · KB (reader)² | Builder, Admin | `[NOW]` |
| Understand | Monitor³ · Reports | Builder, Admin | `[NOW (thin) · v1]` / `[DEFER (full Reports)]` |
| Admin | Settings → Configuration · Members & roles · Branding · Integrations¹ · Billing · Org general · Compliance/Evidence⁴ | Admin/Owner | `[NOW]` |

¹ Automations and Integrations are gated by the automation/integrations capability.
² Reader-facing KB surface (S-03) — distinct from the builder Library; v1 per D-021.
³ Lightweight monitor (S-06 thin) — per-workflow runs index + org-level rollups; v1 per D-021. Full Reports is post-v1.
⁴ Thin compliance/evidence surface (S-10) — v1 per D-021; gated by a `compliance-pack` capability.

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
- **v1.5 shell evolution (D-039 + 2026-05-28 PRD review).** Per canonical
  [PRD_WORKFLOW_SOP_BUILDER.md](PRD_WORKFLOW_SOP_BUILDER.md) §6.2–6.3, v1.5 grows the
  builder shell into a **tri-column layout** (left rail: workflows list, center:
  outline + step editor as today, right rail: persistent Workflow Assistant chat
  panel) with a **persistent top bar** above the canvas (Enabled toggle + Scope chip
  + Review-state banner) and a **Template Variables sidebar** docked bottom-left.
  The slide-in configuration panel is preserved (§4.5 spec below extends it with
  the Edit Action modal pattern). The step-list outline remains canonical per
  D-039 — no node-graph authoring canvas in v1.5; the Read view of a published
  workflow gets a render-only constrained-viewport flowchart visualization (see
  §4.6 below).

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

### 4.5 Workflow Builder shell — v1.5 enhancements `[v1.5a + v1.5b]`

Per the 2026-05-28 PRD review (D-039 / D-040 / D-041), the existing §4.3 builder
gains the following component specs. Cross-references the canonical
[PRD_WORKFLOW_SOP_BUILDER.md](PRD_WORKFLOW_SOP_BUILDER.md) §6.2–6.3; this section
is the UX-side detail.

**Tri-column shell.** Three regions on the Author view:

- **Left rail (~240px).** Workflows list filtered by review state. Reuses the
  existing Library list component; not a new render. Collapsible.
- **Center (flexible).** Outline + step editor as today (§4.3) — sections / steps /
  fields. The canvas region is unchanged in structure; the additions surround it.
- **Right rail (~360px, collapsible).** Persistent **Workflow Assistant** chat panel.
  Always-on during editing (distinct from the pre-generation two-pane review pane
  that lives only at first AI-author time). Driven by `agents.regenerateStep` for
  targeted refinement ("regenerate step 3 to use SMS instead of email") and a
  documentation-aware thread for free-form questions. Each interaction writes an
  `ai_authoring_prompt` row.

**Top bar (above the outline).** Three controls, persistent across edit sessions:

- **Enabled / Disabled toggle** — flips `workflow.is_active`. Disabled workflows
  don't appear in `runs.launch` pickers and don't fire from automation triggers.
- **Scope chip** ("Apply to: All Listings" by default) — click opens an entity-set
  multi-select picker. Updates `workflow.entity_set_ids` optimistically.
- **Review-state banner** — one component, four states (`draft` / `in_review` /
  `published` / `archived`) with state-appropriate copy and CTAs. When
  `organization.require_concierge_review = true`, the draft-state "Publish" CTA
  flips to "Submit for Review."

**Template Variables sidebar (bottom-left, ~240px tall).** Header "TEMPLATE
VARIABLES" + search input + scrollable token list. Tokens derived from
`EntityAdapter.schemaForAI()` for every registered entity type (v1.5: listing
only). Drag-drop into any Tiptap-backed text field — drops as a merge-token chip
rendered with the field-key-locked styling (D-017). **Static token definitions
only**, never live PMS field values (per canonical PRD §5 non-goals + R4 lift).

**Per-step Edit Action modal pattern.** Clicking a step row in the outline opens
the existing Phase 5 Pass 3 slide-in panel, enhanced with:

- **Title** input (existing).
- **Description** Tiptap editor with a **`{}` Template** button anchored top-right
  of the editor toolbar. Click opens a quick-pick of the same tokens surfaced in
  the Template Variables sidebar. This is the canonical merge-token insertion
  entry point.
- **Step-type-specific config** form below the description (existing).
- **Regenerate** button (inline within the panel) — fires `agents.regenerateStep`
  with an optional refinement prompt. Honors D-040 partial-regeneration semantics:
  refuses to write any sibling step where `provenance = 'manually_edited'`; surface
  shows a preview before regen fires listing protected siblings.
- **Delete / Cancel / Save Changes** in the footer.

The slide-in pattern itself is preserved (already shipped); the additions are the
`{}` button + inline Regenerate. v2.0's invented "settings gear on the canvas"
affordance is rejected per the 2026-05-28 screenshot-honest review.

**Per-step provenance chip.** Each step row in the outline shows a small "AI"
chip when `step.provenance = 'ai_generated'`; no chip when `'manually_edited'`.
Hover tooltip explains the partial-regeneration contract (D-040). Clicking a step
to edit it does *not* flip the chip; *saving* the edit does.

### 4.6 Read view — constrained-viewport flowchart render `[v1.5c]`

Per canonical [PRD_WORKFLOW_SOP_BUILDER.md](PRD_WORKFLOW_SOP_BUILDER.md) §6.4
(R5 lift + D-039), the Read view of a published workflow renders a read-only
flowchart visualization alongside the SOP/KB markdown.

- **Layout.** Two columns. Left: markdown rendering of sections / steps / field
  labels / role hints / expected outputs. Right: React Flow embed, ~600px column,
  vertical-stack layout with one branch column.
- **Determinism.** Coordinates computed at render time from the step list. No
  per-user layout state, no `workflow_canvas_layout` table — none exists in v1.5
  (per D-041, layout state stays out of `workflow_version` regardless).
- **Node visuals.** Mirror step types (task / approval / heading / one_off);
  styled per type but **no TCA color palette** — that framing was rejected for
  Workflows per D-039.
- **Edges.** Simple sequential connectors. Branching shown via a
  `precondition_note` chip on conditionally-relevant steps (Phase 6 deferral; no
  branching execution model in v1.5).
- **Interaction.** Read-only. Click a node → scroll the markdown column to the
  matching step. Expand-to-fullscreen affordance for large workflows. No drag,
  no creation, no inline edit.
- **Execution timeline mode.** When the URL has a `runId` query param (linked
  from an Active Run card per §5.6), the right column flips from the
  generic flowchart to a per-run **execution timeline**: chronological list of
  events (Trigger fired / Step N started / Step N completed by X at T / current
  status) sourced from `activity_event`. Static text, no animated coloring; the
  flowchart in the left column dims completed steps and bolds the current step
  (the only visual differentiation v1.5 ships).

---

## 5. Operator screens `[NOW · v1 per D-021]`

Per the pivot (DECISIONS.md D-021), operator screens are **in v1**, not deferred. The
vertical-first launch (property ops) is a runtime-heavy use case — housekeepers,
inspectors, vendors, and property managers live in the run/checklist surfaces every day.
Build order: Phase 7 in BUILD_PLAN.md (after the builder + library set already shipped).
These are the runtime mirror of the build screens; admins can reach them for testing in
the meantime.

**Mode-aware launch + run surfaces.** Per STRATEGY S-07, `runs.launch` carries a mode hint
(`human | ai_assisted | automated`). The Run / Checklist view (§5.3) surfaces which steps
an agent will handle and where the handoff points are. The Guest run view (§5.4) is human
mode only by definition. The mode selector and agent-step affordances are added when
Phase 8 (S-07 wedge) lands; the screens below specify the human-mode baseline.

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

### 5.6 Active Run right-rail card `[v1.5c · per R6 lift + D-039]`

**Purpose.** A compact right-rail card surfaced on entity-context pages (listing
detail, vendor detail, work-order detail, etc.) showing in-flight runs against
that entity — both Workflow runs and Playbook runs. The screenshot-honest answer
to "what's happening with this listing right now" without coupling to an inbox
thread (D-024 reaffirmed — virn-ops does not build a symmetric PM-side inbox
surface).

**Layout.** Right-rail card titled "Active Run" with one row per active run:

- Status chip (Active / Escalated / Blocked).
- Workflow or Playbook name + a small **type chip** distinguishing the two ("Workflow" / "Playbook").
- Started-at timestamp (relative; "started 2h ago").
- Current step or, for Playbooks, the current waiting state ("waiting 4 more days").

**Interaction.**

- Click a Workflow row → opens `/runs/[runId]` (Execute view, §5.3).
- Click a Playbook row → opens `/playbooks/[id]?view=read&runId=<playbookRunId>`
  (Read view with execute-view timeline overlay per §4.6).
- Empty state: "No active runs for this entity."

**Label-override aware.** If the org has overridden `playbooks → lifecycles`
(per the configurable-label mechanism in PRD_PLAYBOOKS §6.6), the type chip on
Playbook rows uses the overridden label. Card title stays "Active Run" (covers
both).

**Surface placement.** Lives in the right rail of: `/library/listings/[id]`,
`/library/vendors/[id]`, future work-order detail pages. Card data backed by
existing run / playbook_run queries scoped by entity participation; no new oRPC
procedures.

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
- **Edit Action modal pattern (v1.5).** Slide-in side panel for per-step / per-field config
  (existing Pass 3 pattern) enhanced with: `{}` Template insert button anchored top-right
  of the Description editor toolbar; inline Regenerate button (when AI authoring is
  enabled for the org) that honors D-040 partial-regeneration semantics; Title /
  Description / type-specific config / Delete / Cancel / Save in the footer. Used in
  both the Workflow Builder (§4.5) and Playbook Builder (per PRD_PLAYBOOKS §6.1).
- **Contextual node-palette flyout (reserved for Phase 13+).** When/if authoring-grade
  canvas ships behind a D-039 ADR override, the node palette is a contextual flyout
  anchored to an edge "+" insertion control — never a permanent left rail. Pattern
  captured here (per R3 lift) so the Phase 13+ implementation inherits the constraint.
- **Provenance chip.** Small "AI" chip on AI-generated step cards (per D-040). No chip
  on manually-edited steps. Hover tooltip explains the partial-regeneration contract.
  Used in both Workflow and Playbook builders.
- **Persistent Assistant chat panel.** Right-rail (~360px, collapsible) chat surface
  on the Author view of both Workflows and Playbooks. Distinct from the pre-generation
  two-pane review pane (which lives only at first AI-author time). Always-on during
  editing; the primary surface for mid-edit refinement. Writes `ai_authoring_prompt`
  rows uniformly with first-generation authoring.

---

## 8. Build-order tie-in

Per BUILD_PLAN.md v2 (post-pivot, D-021). Foundation phases 0–4 are complete; the
Workflow Builder (Pass 1–3) and Library (Pass 1) are shipped. The v1 phases ahead, in
order:

7. Operator surfaces (Home / My Work / Run view / Guest run view) — §5 above.
8. One-procedure-three-modes wedge (S-07) — agent assignee model + mode selector on launch.
9. Data Sets minimal subset (S-02).
10. Reader-facing KB surface (S-03) — *not* specified in this UX_SPEC yet; add when built.
11. Agent-safe action surface (S-01a) — backend (oRPC canonical + optional MCP
    wrapper); UI implications are the agent-assignee affordances in §5.3
    (Run view).
12. AI authoring (S-01b/c) — adds prompt/doc ingress to the Builder's create flow.
13. Tango/Scribe import (S-01d) — adds an import-from-export option in the Library + Builder.
14. Lightweight monitor (S-06) — Understand nav group, thin Reports.
15. Thin compliance / evidence surface (S-10) — Admin nav, gated by capability.
16. Governance flows (approval/review/acknowledge/suggestion UIs).
17. Property-ops pack — content + seeded templates, no new UI surfaces beyond default-populated content.
18. Automation execution — backend; UI implications are in the Builder + Run view.
19. v1 polish + launch readiness.

Reader-KB (Phase 10), agent-step affordances in Run view (Phase 8 + 11), mode selector on
launch (Phase 8), and prompt/doc/import paths on Create (Phases 12–13) are the
UX-relevant additions this spec needs to absorb as those phases are built. Add screen
specs incrementally rather than predicting them.

**v1.5 lifts mapped to phases** (per the 2026-05-28 PRD review + D-039/040/041):

- Phase 9.5 (v1.5a) — §4.5 top bar (Enabled toggle / Scope chip / Review-state banner) + Template Variables sidebar + provenance schema column; backend lights up the `step.provenance` enum and column.
- Phase 12 (v1.5b) — §4.5 Edit Action modal pattern's `{}` Template button + inline Regenerate + provenance chip surface + right-rail Workflow Assistant chat panel; backend enforces D-040 partial-regeneration contract on `agents.regenerateStep`.
- Phase 10 (v1.5c) — §4.6 constrained-viewport flowchart render in Read view + execution-timeline mode + §5.6 Active Run right-rail card on entity-context pages.
- Phase 18a/b/c — Playbook builder mirrors §4.5 (per PRD_PLAYBOOKS §6.1) — same tri-column shell, top bar, Template Variables sidebar, Edit Action modal pattern, persistent chat panel. Read view renders as a timeline (per PRD_PLAYBOOKS §6.5 — asymmetry vs §4.6's Workflow flowchart render is intentional per D-039). Active Run card (§5.6) widens to surface both `run` and `playbook_run` rows.
- Phase 13+ (v1.1+, gated by D-039 ADR override) — contextual node-palette flyout (§7 reserved pattern); only triggered by real customer demand for authoring-grade canvas.

---

## 9. Open / reserved

- Admin / builder / operator / guest / onboarding screens all specified — next is
  implementation per BUILD_PLAN.md v2.
- **Specs to add as phases land (post-pivot, D-021):**
  - Reader-facing KB surface (Phase 10 — S-03).
  - Mode selector on `runs.launch` + agent-step affordances in Run view (Phase 8 — S-07).
  - Prompt → workflow create flow + doc-import (Phase 12 — S-01b/c).
  - Tango/Scribe import flow (Phase 13 — S-01d).
  - Monitor / per-workflow runs index (Phase 14 — S-06 thin).
  - Compliance / evidence surface (Phase 15 — S-10).
- Library grid view + saved/multi-filter views.
- Granular per-action permission matrix UI (area-level ships first).
- Branding / white-label settings screen (premium tier; see BRANDING.md).
- Full Reports / analytics screens (post-v1; thin monitor in v1 covers the immediate need).
- "View as role" admin preview switcher.
- Slack/Teams in-flow delivery surfaces (post-v1 — S-09).

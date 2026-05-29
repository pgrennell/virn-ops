# Antigravity Briefing — Reader-facing SOP Read view + /sop index (Phase 10 / v1.5c)

**Repo:** `c:\Projects\Virn\virn-ops`
**Branch:** `main` (HEAD at the latest commit; everything in scope is pushed)
**Date:** 2026-05-29

## What this is

Phase 10 / v1.5c just shipped end-to-end across four commits:

- `f720fd9` — `sop_read_receipt` schema + idempotent queries + migration
- `4f67e9c` — `workflows.markAsRead` / `getMyReadStatus` / `listReadReceipts`
  procedures (admin-only on the receipt list; cross-org refusal pattern)
- `e350530` — Read view at `/[organizationSlug]/library/workflows/[id]/read`
  rendering a published workflow as an SOP/KB article
- `216eb0a` — `/[organizationSlug]/sop` readers' index + slug reservation

This is the third arm of the three-views unification commitment from D-021:
**Author** view (`/builder`), **Read** view (the SOP/KB article), and the
**Execute** view (the existing run UI) all hang off the same
`workflow_version` row. Authors browse from `/library`; readers browse from
`/sop`; both indexes lead to the same canonical detail page in the
appropriate view.

Unit tests cover the procedure surface (cross-org refusal, idempotency on
re-mark, member vs admin gating). What unit tests can't cover and this
briefing exists for:

1. The Read view actually **reads as an SOP/KB article** — numbered
   timeline, scannable scaffolding, doesn't collapse on a real authored
   workflow with sections + kickoff fields + due rules + step fields.
2. The mark-as-read mutation surface is **idempotent in the browser**: a
   second click on an already-read row never double-writes, the UI swaps
   the button for the "Read on …" badge cleanly, and the admin reader
   count tracks.
3. The `/sop` index is **scannable**: search filters, type chips read,
   drafts/in-review rows don't leak in, empty states render the right
   copy.
4. The **admin/owner vs member split** is enforced in the UI — Edit
   affordance + receipt count are admin-only on the Read view; a member
   session sees neither.

## Goal

Validate that:

1. The Read view renders a real published workflow as a readable SOP — header
   (title + version chip + AI chip + Read badge), kickoff "Required at run
   start" panel when applicable, numbered timeline of sections + steps +
   step fields, footer with Mark-as-read affordance.
2. Mark-as-read works once, is idempotent on subsequent attempts, and the
   `Read` badge + footer copy update without a page reload.
3. The admin/owner gets the Edit affordance + the "N reader(s)" count;
   neither leaks to a member session.
4. The `/sop` index lists only **published** workflows; the substring
   search narrows the list correctly; rows route to the Read view.
5. Member-of-no-published-yet org (or empty list) renders the right empty
   state copy ("No published SOPs yet" vs "No matches").
6. A workflow with no published version renders the "No published version
   yet" empty state on its Read URL, with the Builder link visible only
   for admin/owner.

## Prerequisites

### Dev server

The dev server reads its env from the **monorepo-root `.env.local`** (NOT
`apps/saas/.env.local`):

```bash
cd c:/Projects/Virn/virn-ops/apps/saas
pnpm exec dotenv -c -e ../../.env.local -- next dev --port 3000
```

Wait for "Local: http://localhost:3000" before navigating. If port 3000 is
already taken:

```bash
netstat -ano | grep ":3000" | grep LISTENING | awk '{print $5}' | xargs taskkill //F //PID
```

### Auth

Seeded admin: `pgrennell@gmail.com` in the org with slug `virn`. Magic-link
bypass pattern in `apps/saas/tests/dogfood-walkthrough.spec.ts` — copy that
approach exactly:

- Helper: `waitForVerificationForEmail` from `apps/saas/tests/__helpers/db.ts`
- Callback URL: `http://localhost:3000/api/auth/magic-link/verify?token={TOKEN}&callbackURL=http://localhost:3000/virn/library`

### Member-role session

Scenario E requires verifying that the admin-only affordances (Edit button
on Read view, reader count) do **not** render for a member-role user. Use
the existing member-bypass pattern from `apps/saas/tests/__helpers/`. If
no member is seeded, create one via the invite flow during a precursor
authoring session, OR demote a temporary user via the admin members
surface. Stop and report rather than fabricating session state.

### At least two published workflows + one draft + one in-review

The `/sop` index must demonstrate that only published rows show. Set this
up before running scenarios:

1. Sign in as admin and go to `/virn/library`.
2. Author a fresh workflow via "+ Create" → "Author with AI…" with prompt
   *"Build a 4-step rental turnover SOP: cleaning, inspection, photo
   documentation, listing refresh."* Publish it.
3. Author a second fresh workflow with prompt *"3-step lease renewal
   reminder workflow: 60-day notice, 30-day follow-up, sign-and-return."*
   Publish it too.
4. Author a third workflow and leave it as a **draft** (do not publish).
5. Take a fourth workflow and submit it for review but don't approve it.

Capture the four workflow titles + their states for the report.

### Anthropic API key

Required only for the **authoring** step in Prerequisites above (the
"Author with AI…" path). The Read view + `/sop` scenarios themselves
don't hit the model. Must be in `.env.local` as `ANTHROPIC_API_KEY`. If
missing, fall back to hand-authoring 1–2 workflows so you still have
something to publish, and note this in the REPORT.

## Test plan

Save artifacts under `docs/reviews/sop-read-view-2026-05-29/` and the
spec at `apps/saas/tests/sop-read-view-2026-05-29.spec.ts` following the
existing `getArtifactsDir` pattern.

Tag scenarios **P0 / P1 / P2** to prioritize when running out of time. All
P0 first; P1 if cycles remain; P2 is stretch.

---

### P0 — A. /sop index lists only published workflows

**Scenario:** Navigate to `/virn/sop` as admin; verify only published rows
appear, drafts and in-review do not.

1. After prerequisites are seeded, navigate to `http://localhost:3000/virn/sop`.
2. Wait for the list to load.
3. **Capture:** `01-sop-index-full.png` of the whole page — header copy,
   search input, list of published rows, footer count.

**Verify:**

- The two published workflows from prerequisites are present.
- The draft workflow + the in-review workflow are **absent**.
- Each row shows: title, type chip (Procedure/Document/Policy/Form), `v1`
  (or higher) version chip, the AI sparkle if AI-authored, description
  preview, right chevron.
- Footer count reads `N of N SOPs` matching only the published count.

**Report:**

- Did only the published rows render?
- Were type chips + version chips legible?
- Any console errors on the index page load?

---

### P0 — B. Search narrows the list + empty states render

**Scenario:** Use the search input to filter; verify substring matching
on both title and description; verify both the "no matches" and "no
published yet" empty states.

1. In the search input, type one word from the **first** published
   workflow's title (e.g. "turnover").
2. **Capture:** `02-search-narrowed.png`. The list should narrow to just
   that row.
3. Clear the search; type a word from the **description** of the second
   workflow (not present in any title).
4. **Capture:** `03-search-description-match.png`.
5. Type a random unique string ("zzzzzzzz") that matches nothing.
6. **Capture:** `04-empty-no-matches.png` showing the "No matches" empty
   state with the quoted search term in the copy.

**Verify:**

- Filtering is responsive (no delay > ~200ms; client-side filter).
- Footer count updates to `N of TOTAL` after each filter.
- "No matches" empty state quotes the search term verbatim.

**Report:**

- Did substring matching work on both title and description?
- Did the empty-state copy include the exact search term?
- Any console errors during typing?

---

### P0 — C. Read view renders a published workflow as an SOP/KB article

**This is the load-bearing scenario for this briefing.** The Read view is
the artifact PRD §6.4 promised; if it doesn't *read* as an SOP, the whole
three-views unification investment is on shaky ground.

1. From `/virn/sop`, click the first published workflow row.
2. Land on `/virn/library/workflows/{id}/read`.
3. **Capture:** `05-read-view-full.png` — the entire article. Header,
   any "Required at run start" kickoff panel, the full numbered timeline,
   the footer.

**Verify the header carries:**

- Workflow title as a large heading.
- Type chip + `v1` version chip + AI sparkle (if AI-authored).
- No Read badge yet (you haven't marked it read).
- An **Edit** button (top-right, admin-only) linking back to
  `/virn/library/workflows/{id}/builder`.

**Verify the article body:**

- If the workflow has sections, each section title renders as an `h2`.
- Steps are numbered (1, 2, 3, ...) within each section, with a circular
  number badge.
- Steps marked optional show an `Optional` chip; stop-task steps show a
  `Gate` chip; steps with a due rule show a `DueRule` chip ("due 3d
  after start" or similar).
- Step descriptions render with whitespace preserved.
- Step fields render as a left-bordered list below the step description,
  with field type chip + required marker + select options inline.

**Verify what does NOT render:**

- No "Start a run" button (runs launch from /library or triggers).
- No Workflow Assistant right rail (that's an authoring surface only).
- No left rail for navigation between steps.

**Report:**

- Does the article read top-to-bottom like a procedure document, not a
  form editor?
- Layout intact at default viewport + 1280px?
- Any visual bugs (overflow, chip overlap, ungrouped steps confusingly
  rendered)?
- Any console errors on first paint?

---

### P0 — D. Mark-as-read happy path + idempotency

**Scenario:** Click Mark as read; verify the badge appears and the button
swaps for "Read on …". Refresh and re-click should never double-write.

1. From scenario C, scroll to the footer of the Read view.
2. Click **Mark as read**.
3. **Capture:** `06-just-marked.png` showing:
   - The button replaced by "Marked read on {today}." copy in the footer.
   - The green **Read** badge now in the header next to the version chip.
4. Refresh the page.
5. **Capture:** `07-after-refresh.png` showing the same state persists
   (badge + footer copy, no button).
6. Open the **Network** tab in dev tools and clear it.
7. Attempt to mark again by manually invoking the mutation, or by
   directly POSTing to the mark-as-read endpoint with the same
   `workflowVersionId`. (If the surface offers no re-mark affordance,
   note that — see Verify below.)

**Verify:**

- After the first mark, the success state appears with no full-page
  reload (TanStack invalidation only).
- After refresh, the read state is durable (server-side persisted).
- A second mark request returns success without creating a duplicate
  row (admin-only `listReadReceipts` should still show exactly one row
  for the current user — re-verify in scenario E).
- The header `Read` badge has a `title="Marked read at …"` tooltip
  showing the timestamp on hover.

**Report:**

- Did the swap happen without a full page reload?
- Did the durable state survive the refresh?
- Was the idempotency claim verifiable from the UI alone, or did you
  have to inspect the receipts query response?
- Any console errors during the mutation?

---

### P0 — E. Admin sees reader count; member does not see Edit or reader count

**Scenario:** Cross-role check — the Edit affordance and reader count are
admin-only. A member viewing the same Read URL must see neither.

1. Still signed in as admin, refresh the Read view from scenario D.
2. **Capture:** `08-admin-read-view-header.png` showing the header with
   both: the **Edit** button (top-right) AND the "1 reader" copy in the
   header chip row.
3. Sign out (or switch tabs/browsers).
4. Sign in as a member-role user in the same `virn` org.
5. Navigate to the same `/virn/library/workflows/{id}/read` URL.
6. **Capture:** `09-member-read-view-header.png` showing the header
   **without** the Edit button and **without** the reader count chip.
7. The member should still see the Read view body + footer + Mark-as-read
   button (they haven't marked it).

**Verify:**

- Admin: Edit button present + "N reader(s)" text present.
- Member: neither the Edit button nor the reader-count chip render.
- Member can still mark as read and see their own badge appear.
- Returning to admin, the reader count increments to `2 readers`
  (admin + member).

**Report:**

- Was the role split clean — no Edit leak, no reader-count leak on the
  member session?
- Did the admin's count update to reflect the member's mark?
- Any 403s in the member's network log (specifically, did
  `listReadReceipts` 403 cleanly, or did the client crash on it)?

---

### P1 — F. No-published-version empty state on the Read URL

**Scenario:** Navigate directly to the Read URL of the draft workflow
from prerequisites; verify the empty state and the admin-only Builder
link.

1. As admin, navigate to
   `/virn/library/workflows/{DRAFT_WORKFLOW_ID}/read`.
2. **Capture:** `10-no-published-admin.png` showing the "No published
   version yet" empty state + the "Open in Builder" link.
3. Sign in as the member user (use the auth pattern above).
4. Navigate to the same URL.
5. **Capture:** `11-no-published-member.png` showing the same empty
   state but **without** the "Open in Builder" link.

**Verify:**

- Empty-state copy: "This workflow hasn't been published. Once an admin
  publishes a version it'll appear here as an SOP."
- Admin sees the Builder link; member does not.

**Report:**

- Was the role split correct on the empty state?
- Did the page render at all for the member (no 403, no crash)?

---

### P1 — G. Cross-org refusal renders as not-found, not as forbidden

**Scenario:** Confirm cross-org access doesn't leak workflow IDs.

1. As admin, copy a `{workflowId}` from the `/virn/sop` index.
2. Sign in as a user in a **different** org (or create one via the
   sign-up flow if no second org exists).
3. Navigate to `/{otherOrgSlug}/library/workflows/{workflowId}/read`
   (subbing in the cross-org id).
4. **Capture:** `12-cross-org-read-view.png`.

**Verify:**

- The page renders "Workflow not found" / similar — never reveals the
  workflow's title, version, or any other content.
- No 403 banner that confirms the id exists in another org.

**Report:**

- Was the refusal "not found"-shaped rather than "forbidden"-shaped?
- Any leaked metadata in the network response (the response body for
  `workflows.get` should be a not-found error, not a 403 with the org
  name embedded)?

---

### P2 — H. /sop empty state on an org with zero published

**Scenario:** Stretch — verify the "No published SOPs yet" empty state.

This is hard to set up in the `virn` org since we just seeded published
workflows. Either:

- Sign in to a fresh second org with no published workflows.
- OR: archive every published workflow in `virn`, navigate to `/virn/sop`,
  capture the empty state, then un-archive.

**Capture:** `13-empty-no-published.png`.

**Verify:**

- Copy: "No published SOPs yet — Once an admin publishes a workflow,
  it'll appear here for the whole team to read."
- Search input still renders (disabled UX is fine; just shouldn't crash
  on typing into it).

**Report:**

- Was the copy accurate?
- Did typing into search on an empty list cause a console error?

---

## What to send back

A single markdown report at
`docs/reviews/sop-read-view-2026-05-29/REPORT.md` with:

- **Per-scenario verdict** (PASS / FAIL / PARTIAL) with the captured
  screenshots linked by filename.
- **The P0 — C verdict is load-bearing.** The Read view needs to read as
  an SOP document, not as a stripped-down form editor. If sections /
  numbered steps / chips / step fields visually don't cohere into a
  readable document, report immediately with specifics.
- **Any console errors** observed (paste verbatim, including stack).
- **Specific reproductions** for anything that didn't behave as
  described.
- **"Recommend amend"** markers on anything cheaper to patch than to
  fully verify — particularly visual polish on the Read view chips,
  spacing, or empty-state copy.

The relevant HEAD commits to cite findings against:

- `f720fd9` sop_read_receipt schema + queries + migration `0019`
- `4f67e9c` markAsRead + getMyReadStatus + listReadReceipts procedures
- `e350530` Read view at /[orgSlug]/library/workflows/[id]/read
- `216eb0a` /sop readers' index + forbiddenOrganizationSlugs reservation

---

## Kickoff prompt (paste this to Antigravity)

```
I need browser-driven verification of the Phase 10 / v1.5c reader-facing
SOP surface — the Read view of a published workflow as an SOP/KB article
plus the /sop readers' index that lists what's published. The full
self-contained briefing is at:

  c:\Projects\Virn\virn-ops\docs\reviews\sop-read-view-2026-05-29\ANTIGRAVITY_BRIEFING.md

Read it first — it has prerequisites (dev server, magic-link auth as both
admin + a member-role user, four workflows seeded across published/draft/
in-review states), eight tagged scenarios (P0/P1/P2), capture targets, and
per-scenario reporting expectations.

Priorities: all P0 first, then P1 if cycles remain, P2 stretch. P0 — C is
the load-bearing one: the Read view has to actually *read* as an SOP/KB
article (numbered timeline, scannable scaffolding, chips, kickoff panel),
not as a stripped-down form editor. Report immediately if the rendering
collapses into something that wouldn't pass as a procedure document.

Save artifacts under `docs/reviews/sop-read-view-2026-05-29/` and write
the report at `docs/reviews/sop-read-view-2026-05-29/REPORT.md` —
per-scenario verdict (PASS / FAIL / PARTIAL), screenshots linked by
filename, console errors verbatim, "recommend amend" markers on anything
cheaper to patch than to fully verify.

The relevant HEAD commits are listed at the bottom of the briefing. Repo
is on the `main` branch and up to date.

If any prerequisite fails (port 3000 taken, ANTHROPIC_API_KEY missing for
the seeding step, magic-link not landing, no member-role user available)
— STOP and report rather than guessing. The briefing flags the known
landmines in its Prerequisites section, including the fallback to
hand-authoring if the AI authoring path is unavailable.
```

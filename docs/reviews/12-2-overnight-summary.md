# Overnight session summary — 2026-05-28

10 commits pushed to `main`. Pure code work, no destructive ops, no schema
migration. Workspace type-check clean. **315 api tests + 137 saas tests + 3
auth tests = 455 total, all passing.**

## What landed

### Phase 12.2 — widen the `due_type` palette end-to-end

The dueType enum has had four values forever, but only two (`none` +
`offset_from_start`) were resolvable at launch. Phase 12.2 wires the other two
across the stack.

| Commit | Layer | What |
|---|---|---|
| [981764c](https://github.com/pgrennell/virn-ops/commit/981764c) | run engine | `computeStepDueAt` resolves `from_date_field` at launch when the source is a kickoff date field; signature widens to take a step + context object |
| [71b3905](https://github.com/pgrennell/virn-ops/commit/71b3905) | run engine | `recomputeDueAtAfterStepCompletion` patches deferred dependents when an anchor step completes or a step-scoped date field gets a value; wired into `completeRunStep`'s transaction |
| [41bd84a](https://github.com/pgrennell/virn-ops/commit/41bd84a) | AI authoring | validator widens to accept all four dueTypes with per-type invariants (`dueAnchorStepIndex`, `dueSourceFieldKey`); authoring lib does a two-pass insert to resolve refs; prompt teaches semantics |
| [06d56e2](https://github.com/pgrennell/virn-ops/commit/06d56e2) | Builder UI | StepConfigForm gains anchor-step picker + date-field-source picker; offset input shows for the three relevant dueTypes; `capability-gates` flips all four to enabled |

**Resolution semantics:**

- `offset_from_step` → `anchor.completedAt + offsetDays`. Resolved when the
  anchor completes (recompute hook). Negative offsets allowed but only resolve
  AFTER the anchor completes (semantically "X days before, planning use only").
- `from_date_field` → `sourceField.value + offsetDays`. Kickoff sources
  resolve at launch; step-scoped sources resolve when their step completes.
  Source must be `fieldType: 'date'`.

### Phase 12.2 — correctness guards

| Commit | What |
|---|---|
| [3caa920](https://github.com/pgrennell/virn-ops/commit/3caa920) | Server-side validation in `createStep` + `updateStepOp`: rejects `dueAnchorStepId` pointing at a step in a different version, self-anchor, `dueSourceFieldId` pointing at a non-existent / cross-version / non-date field. 4 new error codes. |
| [268e2a9](https://github.com/pgrennell/virn-ops/commit/268e2a9) | `updateFieldOp` refuses a `fieldType` change when the field is referenced by a `from_date_field` due rule or an automation condition (`FIELD_TYPE_CHANGE_LOCKED`). Same posture as the existing `FIELD_KEY_LOCKED` guard. |
| [ec998d6](https://github.com/pgrennell/virn-ops/commit/ec998d6) | FieldConfigForm renders inline `FIELD_TYPE_CHANGE_LOCKED` refusal hint listing the referencer kinds. Mirrors the existing key-rename refusal UX. |

### Phase 12.2 — observability

| Commit | What |
|---|---|
| [43e3102](https://github.com/pgrennell/virn-ops/commit/43e3102) | Due-rule chip rendered under each step title in the author sidebar: "due 3d after Inspect kitchen", "due 1d before {{guest_arrival}}", "due rule incomplete" for partial configs. Author mode only — runs use runtime dueAt instead. |

### Phase 12.1 — small polish

| Commit | What |
|---|---|
| [821028a](https://github.com/pgrennell/virn-ops/commit/821028a) | AI chip on Library rows (mirrors the Builder header chip). Workflows authored via `agents.authorWorkflow` get a small violet Sparkles chip in the Library list. |

## Caveats worth your attention

1. **`markRunStepCompleted` return type changed** from `Promise<void>` to
   `Promise<{ completedAt: Date }>` so the recompute hook uses the same
   timestamp the audit row records. Internal-only — anyone calling this
   directly from outside `@virn/api` would feel it; nothing does.

2. **Negative offsets for `offset_from_step`** are allowed but only resolve
   AFTER the anchor completes. Semantically "5 days before X" reads as
   planning-only — the actual `dueAt` lands as `anchor.completedAt - 5d` once
   the anchor completes, by which point the "before" window is already past.
   If you want a hard pre-completion gate (warn earlier), that's a separate
   feature. Flag if you'd rather forbid negative offsets entirely.

3. **Builder due-rule pickers don't visualize step ordering.** The
   anchor-step picker shows ALL other steps, including steps that come AFTER
   the dependent in the position order. The run engine handles this correctly
   (anchor just needs to complete first regardless of position), but there's
   no UI hint of step ordering. Consider sorting by position in the picker
   later.

4. **Server-side dueType validation does NOT enforce "dueType requires
   companion"** (e.g., `dueType=offset_from_step` without an anchor). The
   Builder's two-step UI and the AI authoring lib's two-pass insert both
   legitimately set dueType BEFORE the companion ref; enforcing the
   requirement would break both flows. The launch path returns null for
   incomplete configs ("deferred") and the recompute hook patches when the
   missing piece arrives.

5. **Memory updates:** `project_due_type_ui_constraint.md` rewritten as a
   "pattern to follow when widening further" entry; `project_builder_pass3_constraints.md`
   constraint #4 marked CLEARED.

## What's still open (not done; flagging for direction)

- **Antigravity dogfood for Phase 12.2.** The new UI hasn't been browser-tested.
  The dogfood briefing pattern from 12.1 would adapt directly; happy to write one.
- **Step-ordering hint in the anchor picker** (caveat #3 above).
- **Provenance inspector panel** — a "View original prompt" affordance on the
  Builder header AI chip that opens a small viewer over the
  `ai_authoring_prompt.responseJson`.
- **Regenerate-with-feedback (Phase 12.2/12.3).** Bigger lift; design calls.
- **The duplicate `+ Create` button** (Library page header vs. global TopBar).
  Saved as memory; still real UX issue.

## Test counts

| Layer | Before this session | After |
|---|---|---|
| `@virn/api` | 295 | 315 (+20) |
| `apps/saas` | 125 | 137 (+12) |
| Total (incl. auth) | 423 | 455 (+32) |

Workspace type-check stayed clean throughout. Every commit was green before
push.

# SCRATCHPAD.md

Personal scratch-file of saved excerpts, raw thinking, and open questions that haven't earned a place in the formal doc set yet. Maintained manually by Paul Grennell.

**Not loaded by any agent. Not referenced by other docs. Intentionally disconnected** —
keep it that way. The point is to have somewhere to capture below-the-threshold material without forcing it through the same bar as `DECISIONS.md` / `STRATEGY.md` / `ARCHITECTURE.md`.

**What goes in here.** Anything worth remembering: research excerpts, AI-conversation
takeaways, half-formed ideas, prompts to revisit, open questions, observations from other products. The bar is "would future-Paul be annoyed to have lost this?" — not "does this significantly impact the architecture?" That higher bar is what `DECISIONS.md` is for.

**Per-entry shape.** Each entry should carry a few light fields so the file stays scannable as it grows:

- `Kind:` — `research` (captured from elsewhere), `question` (something to resolve later), or `idea` (something to explore)
- `Source:` — where it came from (which conversation, product, article, thought)
- `Status:` — what's happened with it since (`open`, `informed STRATEGY.md v1`,
  `superseded by X`, `acted on`, etc.)
- `Tags:` — 2–4 keywords for `grep`-ability later

Date-group entries under `## YYYY-MM-DD` headings; one `###` heading per distinct entry
within a date.

---

## 2026-05-26

### Marketing description — first ~100-word pass

- **Kind:** idea
- **Source:** Claude conversation, marketing/sales description drafting
- **Status:** **superseded by DECISIONS.md D-021** — this draft led with the platform-of-products framing; the pivot (2026-05-26) re-anchors the public lead to vertical-first (property ops) + the one-procedure-three-modes wedge (STRATEGY S-07). The platform framing moves to long-term moat (STRATEGY S-11), not headline copy. A new marketing draft against the pivoted positioning is still TBD.
- **Tags:** marketing, positioning, sales, copy, superseded

> **Virn Ops is the operations platform for teams that run on process.** Build recurring checklists, living SOPs, and policy knowledge bases in one workspace — then automate them with no-code workflows and inline conditional logic. Assign work to your team or to external guests via a single link, no login required. Every published workflow is version-controlled, so edits never break in-flight runs, and every run is governed by sign-off, acknowledgment, and a complete audit trail. One platform, configurable for short-term rentals, agency client ops, compliance, HR — any process where consistency matters.

**What this aimed for and where it could flex:**

- **Lead.** "Operations platform for teams that run on process" — flex if a stronger lead is wanted ("the operating system for repeatable work") or softer ("workflow software for ops teams"). Mid by choice.
- **Four-product synthesis in one sentence.** Checklists + SOPs + KB + workflow automation — that's the answer to "what does this actually do?" and it implicitly positions against Manifestly + Process Street + SweetProcess + Tallyfy (a buyer evaluating those four reads this and thinks "oh, one tool instead of four").
- **Three differentiators called out explicitly:** guests with no login (Tallyfy parity), snapshot-isolated publishing (the D-018 guarantee, phrased as a benefit not a mechanism), and the governance trail (SweetProcess parity). Avoided saying "snapshot" because it's a how-not-what.
- **No AI mention.** Matches the current "AI is roadmap, not focus" stance — when ready to introduce S-01 publicly, that becomes a separate line to add.
- **The verticals list is the platform-of-products tell** without using the word "platform" twice. Drop the list and the platform angle disappears; keep it and prospects in those industries self-identify.

**Two angles considered and chose against — flag if you want either back in:**

1. **Lead with the vertical first**, then platform ("Virn Ops runs short-term rental turnovers — and any other process where consistency matters"). More concrete, but it locks into STR positioning before it's shipped.
2. **Lead with the pain** ("Stop running your ops in five different tools..."). Punchier, but assumes the reader already feels the pain — works in cold email less well on a website.

---

### Four-app competitive read (Manifestly / Process Street / SweetProcess / Tallyfy)

- **Kind:** research
- **Source:** Claude conversation analyzing the four reference products against Virn Ops
- **Status:** **historical / superseded as strategic frame by DECISIONS.md D-021** — these four are now demoted to data-shape lessons (STRATEGY.md Appendix A); the strategic competitive frame moved to the AI-native cohort (Scribe, Tango, n8n, Lindy, Gumloop) + the property-vertical comps (Breezeway, Operto, Properly, etc.). Preserved here for the architectural lessons embedded in our schema, not for current positioning calls.
- **Tags:** competitors, AI, data-sets, agent-native, KB, scorecard, historical

Manifestly — recurring runs. Their whole identity is recurring scheduling: they're 100% focused on recurring SOPs/checklists/workflows, scheduled daily/weekly/monthly, with role-based recurring assignment and an initiator role that auto-assigns the run creator. Virn captures this cleanly — schedule + scheduleFrequency + Inngest for the cron sweep, workflowRole.isInitiator, run_role_assignment. Two Manifestly touches worth noting you already modeled: workflow chaining — completing a step auto-creates and assigns another run, passing data forward (your run_workflow automation action), and a unified inbox consolidating assignments/runs/tasks plus bird's-eye summary views across all runs of a workflow. The inbox is your My Work (07); the bird's-eye "all runs of one workflow" summary is not specified anywhere in your docs — that's a manager surface gap.

Process Street — unified library + My Work, but the real story now is Data Sets + AI. The library/My-Work pattern you took is right, but PS has moved its center of gravity to two things you've reserved but deferred. First, Data Sets — a central repository that auto-populates form fields and feeds variables/conditional logic across workflows. Your data_set/data_set_field/data_set_record + lookup field type are reserved (ARCHITECTURE §5, BUILD_PLAN Batch 7) but explicitly deferred — and this is the multiplier that makes the automation engine you're building actually valuable. Second, Process AI: an AI workflow generator, AI tasks (compute due dates, generate language), and an AI document importer that turns existing docs into workflows. One strong validation, though: PS's Preview is a sandbox that lets you preview as different users/roles and test conditional logic and permissions before publishing — which is exactly your Pass 2 dry-render preview plus the reserved "View as role" switcher. That's independent confirmation the dry-render was the right call over the spec's "throwaway run" language (another reason to do that doc reconciliation).

SweetProcess — SOP/policy governance. You took the right thing, and your governance data model is strong: version_approval, acknowledgment (their sign-off), suggestion, next_review_at/review_interval_days. SweetProcess's distinctive moves are a three-tier policies→processes→procedures hierarchy with direct linking between documents, plus a searchable public/private knowledge base with built-in version control and approve-then-sign-off. Two gaps surface here. Your workflow.type is a flat discriminator — there's no inter-document linking (procedure references policy) specified. And more importantly, you have no reader-facing knowledge base — the Library is builder-facing, but SweetProcess's core value is the employee who searches, reads, and acknowledges an SOP. You model all the data for it; you just haven't specified the read/search/acknowledge surface.

Tallyfy — process builder + automation. This is where Virn is genuinely on par or ahead. Tallyfy's signature is unlimited no-login guest access via a single permanent link, with self-delegation — and your first-class participant model, guest run view, and tokenized links match it directly. Their builder philosophy — no flowcharts, just steps with simple if-this-then-that conditionals — is exactly your inline show-when-on-the-step approach. Where they've pushed ahead: assigning steps to AI agents, AI/upload-driven template creation, and a "bring your own AI" model letting you plug in your own ChatGPT/Claude subscription. Tallyfy + 4

So the pattern across all four: AI generation is now table stakes — every one of them drafts workflows/SOPs from a prompt and imports existing docs (Manifestly uses GPT-4 to suggest steps, SweetAI drafts full SOPs from a title, PS and Tallyfy as above). Virn has the AI seam (the stream-message procedure, the reserved step.type = ai) but no specified AI authoring, AI steps, or doc import. That's your single biggest gap relative to the market.

Three strategies I'd actually push:
The AI posture is a decision, and I'd argue Virn is positioned to win it differently. Note Manifestly's contrarian stance — they refuse to "bolt sloppy AI features in" and instead make the tool clean for the AI agents teams already run, so permissions and audit stay intact. That's the agent-native posture, and Virn is unusually suited to it: strict org-scoping, append-only audit, and a clean oRPC procedure surface are exactly what a safe, auditable agent action layer needs. The move is to expose your workflow/run procedures as an MCP server so "an agent drafts a workflow / launches a run / completes a step" is first-class and logged — a differentiator only Tallyfy's BYO-AI gestures at. Then add the table-stakes generation (prompt→workflow, doc→workflow), which your section/step/field/key model is ideally shaped for an LLM to emit as structured output.

Pull Data Sets forward from "deferred." It's the highest-leverage deferred seam because it compounds the automation engine you're already building — conditions, merge variables, and field auto-fill all get dramatically more useful once data can be stored once and referenced everywhere. PS's recent trajectory is the evidence.
Don't lead with the packs/platform model — it's your long-term moat, but ARCHITECTURE's own "ambitious model, narrow first build" principle is correct, and none of these four are platforms (they're single products). The win condition is making one vertical — STR turnover — genuinely better than running it in Process Street, then the packs model repeats it cheaply. The reader-facing KB surface and a lightweight run-summary/reporting view are the two things most likely to make that first vertical feel complete rather than half-built, and both are mostly UI over data you already model.
Net: structurally you're capturing the best of all four, and your publish/snapshot immutability (D-018), two-axis gating, and guest model are more principled than most of the incumbents. The exposure is that the market has moved to AI-native and data-reuse-heavy while those sit in your "reserved/deferred" column — so the question isn't whether your architecture can hold them (it can), it's whether they stay deferred long enough that the first vertical ships feeling a generation behind.

---

### Pause-and-reconsider: re-evaluate scope/direction before more dev

- **Kind:** question
- **Source:** Paul, 2026-05-26 — direct prompt to self before continuing development
- **Status:** **acted on — see DECISIONS.md D-021 (2026-05-26).** Outcome: hard pivot. Vertical locked to property operations; AI authoring + MCP agent surface + Data Sets minimal + reader-KB + operator surfaces all promoted to v1; four-app reference set demoted to historical / data-shape lessons; platform-of-products framing preserved as long-term moat (STRATEGY S-11), not v1 public lead. STRATEGY.md, BUILD_PLAN.md, ARCHITECTURE.md, agents.md, BRANDING.md, UX_SPEC.md all rewritten in the same change set.
- **Tags:** strategy, pivot-check, scope, competitive, acted-on

Before going further with development, stop and re-examine whether Virn Ops is still on the right track in light of the four-app competitive read above (and any further competitive research). If a pivot is warranted, do it **now** rather than after more code is committed against the current shape.

**Specific things to pressure-test:**

- **AI posture.** Competitive read says AI generation is now table stakes across all four reference products. Current stance ("AI is roadmap, not focus", S-01 deferred) — is that still defensible, or does the first vertical ship feeling a generation behind without at least prompt→workflow and an agent-native MCP surface?
- **Data Sets deferral.** PS's center of gravity has moved here, and it compounds the automation engine already being built. Is keeping it in "reserved/deferred" the right call, or does pulling it forward change what "feature-complete v1" means?
- **Reader-facing KB surface.** All the data is modeled; no read/search/acknowledge surface is specified. Is this a gap that makes the SOP/policy story feel half-built in the first vertical?
- **Platform-of-products framing vs. single-vertical win.** ARCHITECTURE's "ambitious model, narrow first build" principle says ship STR turnover first. Marketing copy draft (above) leans platform. Which framing is actually load-bearing for the first 12 months?
- **Anything else surfaced by further competitive research** — add sub-entries here as it comes in.

**Decision to make:** stay the course, adjust scope at the edges, or take a structural pivot. Capture the outcome in `DECISIONS.md` (or supersede this entry) before resuming dev.

---

### Growth scorecard v2 — competitor momentum landscape (HTML visualization)

- **Kind:** research
- **Source:** Claude conversation, competitor momentum analysis with HTML scorecard (v2 adds vertical PropTech AI band)
- **Status:** open — sharpens the pause-and-reconsider questions above; not yet integrated into STRATEGY.md
- **Tags:** competitors, market, momentum, funding, visualization, str, proptech

[Open the visualization](./virn-ops-growth-scorecard.html) — tier-ranked momentum scorecard of **15 products** across the process / workflow / SOP-capture / AI-orchestration landscape, with funding, valuation, and usage signals per row, plus a "what this means for Virn" read at the bottom. **v2** adds a fifth band — vertical PropTech AI — for the products that sit directly in Virn's lane at a different scale.

**The headline:** all four originally-named comps still sit in Tier 3 or 4 — Process Street (52, defending via "compliance ops" repositioning), SweetProcess (38, bootstrapped/profitable), Tallyfy (32), Manifestly (28). Tier 1 hypergrowth is AI-native: n8n ($2.5B, $40M ARR, 10× YoY usage), Scribe ($1.3B unicorn moving into "Workflow AI"), Gumloop (Benchmark-led). Tier 2 includes Tango (building toward AI-executable docs — the same wedge as STRATEGY S-07), Lindy, Guidde, Relay.app.

**The new fifth band (vertical PropTech AI):** Besty AI (55 — $1.5M seed, NYC, STR-locked, 0→250 customers / 15K properties / ~34% MoM, 12-feature OS with Workflow & SOP Builder + AI KB already shipped) and Propvana (30 — funding undisclosed, LTR-residential voice AI, narrow 2-workflow scope, crowded lane vs EliseAI). These are the closest live analogues to what Virn Ops is building — they validate the thesis, and their narrowness validates Virn's cross-vertical wedge. Pairs directly with the Besty overlap-map entry below.

**The sharpest pointer:** Scribe Optimize — capture the work, then tell the customer where AI/agents should take over — is the highest-value real estate on the board, and it's the same bridge S-07 (one procedure → human / AI-assisted / automated) is built around.

**Note for next STRATEGY.md re-score:** several Tier-1/2 players (n8n, Scribe, Gumloop, Lindy, Tango) live in §2's "adjacent landscape" prose but aren't in §6's scorecard. v2's vertical PropTech AI band (Besty, Propvana) also needs to land in §6 — they're the most direct competitors and they're not represented at all yet. Worth deciding whether some belong as additional rows or alternate columns on the rows where they're the actual competition (auto-capture authoring, AI-over-KB, agent action surface, vertical specialists).

---

### Besty vs. Virn — competitive overlap map (HTML visualization)

- **Kind:** research
- **Source:** Claude conversation, capability-band overlap analysis between Besty (STR vertical) and Virn (Ops + PM)
- **Status:** open — reframes the Besty threat in light of D-021's vertical-first pivot; not yet reconciled with STRATEGY.md's competitive section
- **Tags:** competitors, positioning, str, besty, visualization

[Open the visualization](./besty-vs-virn-overlap-map.html) — three-band capability matrix (head-on collision / Besty's STR lane / Virn's open territory) comparing Besty, Virn Ops, and Virn PM across 12 capabilities, with a "bottom line" read at the bottom.

**The headline:** real overlap is one band wide — SOP builder, AI knowledge base, checklists — and even there Besty is STR-flavored and STR-locked. Their middle band (autopilot guest messaging, upselling, unified OTA inbox, guest portal, turnover ops) is a vertical we've explicitly not chased. Virn's structural moat is the bottom band: cross-vertical configurability, flexible data model, lease/vendor/asset depth, and non-PM verticals (IT Ops, field service, facilities) — terrain Besty can't follow into without abandoning what makes them fast.

**The sharpest pointer:** don't clone Besty's builder — clone its *feel* ("describe it, watch it build") on top of a vertical-agnostic engine. That maps directly onto the AI-authoring + agent-safe action surface promoted to v1 in D-021.

**Tension to resolve in STRATEGY.md:** post-D-021 we *are* now vertical-first on property ops, which narrows the gap on the "Virn's open territory" band against any vertical PM competitor (not just Besty). The map's framing — "horizontal, configurable platform that allows STR" — is the long-term S-11 framing, not the v1 public lead. Worth a pass to make sure the competitive narrative matches the actual v1 surface rather than the long-term moat.

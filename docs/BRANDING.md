# BRANDING.md

Brand and domain architecture for Virn. Applies across all Virn products — keep a copy in each
product repo so configuration stays consistent.

## Master brand

**Virn** (virn.com). Branded-house model: one master brand, distinctly-named products under it.

## Products & domains

| Product | What it is | Domain | Repo |
|---|---|---|---|
| (marketing) | Company + product marketing | virn.com / www.virn.com | separate / TBD |
| **Virn Ops** | Property operations OS — turnover, inspections, maintenance, vendor/tenant onboarding (v1 vertical). Built on a workflow/SOP/automation engine with an agent-native action surface; architected to host other process-shaped products as packs post-v1 | ops.virn.com | virn-ops |
| **Virn PM** | Property management (formerly Propvana) — the SoR / records / accounting sibling to Virn Ops within property | pm.virn.com | virn-pm |
| docs | Product documentation | docs.virn.com | TBD |

## Subdomain system

- One short subdomain per **distinct product** (`ops`, `pm`, future `crm`, …) — never one per
  feature. Checklists/SOPs/automation are all one product (Virn Ops), so one subdomain.
- Tenants route by **org slug in the path** (`<product>.virn.com/[orgSlug]/…`) — the Supastarter /
  Better Auth pattern. Do **not** use per-tenant subdomains; pick the per-product axis only.

## Per-app configuration

Each product app sets, for **production only** (leave dev on localhost):
- `NEXT_PUBLIC_SAAS_URL` = its own subdomain (`https://ops.virn.com`, `https://pm.virn.com`).
- Marketing / docs URLs — `https://virn.com`, `https://docs.virn.com`.
- Better Auth `baseURL` + trusted origins include its own subdomain.

## Shared sign-in (roadmap)

One Virn account across products via a `.virn.com` cookie domain. **Promoted from
"deferred" to "roadmap commitment" 2026-05-27** (see `docs/DECISIONS.md` D-031). The
2026-05-27 worked example (pest control service request: tenant → PM → Ops → vendor → PM
→ manager) surfaced the two-account UX cost as real, not theoretical. Apps currently
have separate Neon databases, so true single-account SSO needs a shared auth store or
OAuth federation first. Two shapes recorded; pick at trigger:

- **(a) Shared auth store** — one Better Auth instance behind both `pm.virn.com` +
  `ops.virn.com`, org membership tagged per product. Cleaner UX, more migration work.
- **(b) OAuth federation** — independent Better Auth instances per app, each trusts
  the other as OIDC provider. More decoupled, more UX surface.

**Trigger:** first paying customer using both products, OR customer-facing UX research
flagging two-account UX as a sales blocker, OR first cross-product feature beyond PM's
Service Request Router that requires a single signed-in identity across the boundary.
Configure per-app auth for now.

## White-label / custom domains (roadmap, premium tier — asymmetric scope per product)

**Promoted from "deferred indefinitely" to "roadmap commitment" 2026-05-27** (see
`docs/DECISIONS.md` D-032). PM sells branded experiences to PMs' customers (owners,
tenants); "Powered by Virn" badges are a real sales objection. Ops's typical customer
(internal operations team) is less brand-sensitive but enterprise Ops customers still
expect their internal tools to wear their own brand. Scope is **asymmetric** between the
two products:

- **Virn PM scope (broader):** the staff app itself (e.g. `staff.acmepm.com` themed
  end-to-end with no "Virn" mark on the staff surface), owner portal, tenant portal,
  outbound email sender domains (`mail.acmepm.com`), generated PDFs (lease docs, owner
  statements, work-order summaries).
- **Virn Ops scope (narrower):** operator dashboards, run editor, settings UI. No SoR
  or portal layer to brand. Optional: outbound email + emitted artifacts (run reports,
  KB excerpts).

Shared primitives (both products implement):
- `organization_domain(id, organizationId, hostname, certStatus, isPrimary)` per-org
  hostnames table.
- Hostname → org middleware (active-org pattern extends to "hostname OR URL slug").
- `branding_settings` group under the data-driven settings registry (`logo_url`,
  `primary_color`, `display_name`, `sender_name`, `email_footer_html`, etc.).
- Cert provisioning via Cloudflare for SaaS or Vercel custom domains.
- Outbound email sender domain via Resend's verified-domains API per-org.

**Trigger:** first customer who pushes back on Virn branding in a surface they control,
OR first sales conversation where white-label is the deciding feature. Likely fires in
PM first.

## How the products relate

**Virn Ops v1 is the property-operations OS** — turnover, inspections, maintenance routing,
vendor & tenant onboarding. Under the hood it's a process/workflow/automation engine with
an agent-safe action surface (credentialed oRPC API + optional MCP wrapper; see STRATEGY S-01a). That engine is architected to host other
process-shaped products (marketing ops, agency client ops, compliance SOPs, HR ops) as
solution packs the ServiceNow way — but the platform-of-products framing is a **post-v1
destination**, not the v1 public story. v1 wins property ops decisively; the pack model
repeats the win afterwards. See `STRATEGY.md` S-11 and `DECISIONS.md` D-021 for the
rationale.

**System-of-record / ERP-shaped products — like Virn PM, with its accounting, leases, and
property records — are separate apps with their own databases.** They are **not** packs on
Ops. They share the platform **foundation** (brand, domain, identity, billing, UI library,
conventions) and may later consume Ops's workflow engine for their process features (work
orders, turnover, inspections) while keeping their domain core their own. Especially
relevant now that both target property: Virn Ops owns *operations* (process / workflow /
SOPs / KB / agent execution); Virn PM owns *records* (leases, GL, invoices, owner
statements). They're adjacent products on the same vertical.

So the destination is a **product family on a shared foundation** (the Zoho / Atlassian
model), not one app. `pm.virn.com` as a separate app is most likely **permanent**; the
*relationship* with Ops deepens over time (shared identity, and possibly a shared workflow
engine for PM's process bits) — the codebases do not merge. The rule of thumb:
process/operations work is Ops territory and can be packs; financial / system-of-record /
ERP work is its own app sharing the foundation.

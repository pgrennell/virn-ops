# BRANDING.md

Brand and domain architecture for Virn. Applies across all Virn products — keep a copy in each
product repo so configuration stays consistent.

## Master brand

**Virn** (virn.com). Branded-house model: one master brand, distinctly-named products under it.

## Products & domains

| Product | What it is | Domain | Repo |
|---|---|---|---|
| (marketing) | Company + product marketing | virn.com / www.virn.com | separate / TBD |
| **Virn Ops** | Workflow / SOP / process / automation platform (flagship) | ops.virn.com | virn-ops |
| **Virn PM** | Property management (formerly Propvana) | pm.virn.com | virn-pm |
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

## Shared sign-in (deferred)

One Virn account across products via a `.virn.com` cookie domain. Deferred: the apps currently have
separate Neon databases, so true single-account SSO needs a shared auth store or OAuth federation
first. Configure per-app auth for now.

## White-label / custom domains (deferred, premium tier)

Customers point `app.<theirdomain>.com` via CNAME at a Virn target; managed per-hostname certs via
Cloudflare for SaaS or Vercel custom domains; middleware resolves hostname → org; per-org branding
(logo, colors, app name) via the org-settings system. Needs an `organization_domain` table + a
branding settings group.

## How the products relate

Virn Ops is the process/workflow/automation **platform**. Other **process-shaped** products
(marketing ops, STR turnover, compliance SOPs, …) can run on it as packs/configurations.

**System-of-record / ERP-shaped products — like Virn PM, with its accounting, leases, and property
records — are separate apps with their own databases.** They are **not** packs on Ops. They share
the platform **foundation** (brand, domain, identity, billing, UI library, conventions) and may
later consume Ops's workflow engine for their process features (work orders, turnover, inspections)
while keeping their domain core their own.

So the destination is a **product family on a shared foundation** (the Zoho / Atlassian model), not
one app. `pm.virn.com` as a separate app is most likely **permanent**; the *relationship* with Ops
deepens over time (shared identity, and possibly a shared workflow engine for PM's process bits) —
the codebases do not merge. The rule of thumb: process/operations work is Ops territory and can be
packs; financial / system-of-record / ERP work is its own app sharing the foundation.

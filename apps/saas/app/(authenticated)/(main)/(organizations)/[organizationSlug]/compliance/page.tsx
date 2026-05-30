// Phase 15 -- thin compliance / evidence reader landing (S-10).
//
// Gates on NAV_AREAS.compliance which composes capability=compliance.pack +
// role in {reviewer, admin, owner}. Orgs that haven't flipped the capability
// 404 here -- same posture as /automations when the automation.rules
// capability is off.
//
// The landing is intentionally thin in Slice A: it explains what's reachable
// and links to the per-entity surfaces. Slice D populates the Acknowledgments
// index + receipt views below; per-workflow audit lives at the workflow
// detail's new Audit tab (Slice C), reachable from /library.

import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";
import { ClipboardCheck, FileSearch, Lightbulb, ShieldCheck, UserCheck } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compliance" };

export default async function CompliancePage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;
	await assertCanSee(organizationSlug, NAV_AREAS.compliance);

	return (
		<div className="h-full min-h-0 p-4">
			<div className="rounded-lg border border-border bg-background overflow-hidden">
				<header className="px-4 py-3 border-b border-border">
					<div className="flex items-center gap-2">
						<ShieldCheck className="size-4 text-foreground/60" />
						<h1 className="font-medium text-sm">Compliance</h1>
					</div>
					<p className="text-xs text-foreground/60 mt-0.5">
						Audit trails and evidence receipts for governance review.
					</p>
				</header>
				<div className="p-4 gap-3 flex flex-col">
					<ComplianceLink
						href={`/${organizationSlug}/compliance/approvals`}
						icon={<ClipboardCheck className="size-4" />}
						title="Pending approvals"
						subtitle="Decide on workflow-version approval requests. Off until governance.approvals is enabled."
					/>
					<ComplianceLink
						href={`/${organizationSlug}/compliance/acknowledgments`}
						icon={<UserCheck className="size-4" />}
						title="Acknowledgments"
						subtitle="Read-only evidence of who acknowledged which workflow version, when."
					/>
					<ComplianceLink
						href={`/${organizationSlug}/compliance/suggestions`}
						icon={<Lightbulb className="size-4" />}
						title="Suggestions"
						subtitle="Triage improvement feedback from operators. Off until governance.suggestions is enabled."
					/>
					<ComplianceLink
						href={`/${organizationSlug}/library`}
						icon={<FileSearch className="size-4" />}
						title="Workflow audit timelines"
						subtitle="Open any workflow in Library and switch to the Audit tab to see its lifecycle history."
					/>
				</div>
			</div>
		</div>
	);
}

function ComplianceLink({
	href,
	icon,
	title,
	subtitle,
}: {
	href: string;
	icon: React.ReactNode;
	title: string;
	subtitle: string;
}) {
	return (
		<Link
			href={href}
			className="rounded-md border border-border bg-background hover:bg-muted/30 p-3 flex items-start gap-3 transition-colors"
		>
			<div className="size-8 rounded-md bg-muted/50 flex items-center justify-center text-foreground/60 shrink-0">
				{icon}
			</div>
			<div className="min-w-0">
				<div className="font-medium text-sm">{title}</div>
				<div className="text-xs text-foreground/60 mt-0.5">{subtitle}</div>
			</div>
		</Link>
	);
}

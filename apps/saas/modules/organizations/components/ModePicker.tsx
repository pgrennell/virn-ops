"use client";

// Shared mode-picker primitive used by:
//   - Configuration page (apps/saas/modules/organizations/components/OrgConfigurationManagement.tsx)
//   - Onboarding flow  (apps/saas/modules/onboarding/components/OnboardingModePicker.tsx)
//
// Purely controlled: the parent owns the selected value and decides what happens on
// change (Configuration opens a confirmation dialog; onboarding holds it as draft state
// until the user clicks Continue).

import { cn } from "@virn/ui";
import { BookOpen, CheckSquare, Zap } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

export type EnablementProfile = "checklist" | "sop" | "automation";

interface ProfileMeta {
	name: string;
	icon: ComponentType<SVGProps<SVGSVGElement>>;
	description: string;
}

export const PROFILE_META: Record<EnablementProfile, ProfileMeta> = {
	checklist: {
		name: "Checklist",
		icon: CheckSquare,
		description: "Recurring processes and task lists — onboarding, turnovers, monthly closes.",
	},
	sop: {
		name: "SOPs & policies",
		icon: BookOpen,
		description: "A living knowledge base with approvals, acknowledgments, and guests.",
	},
	automation: {
		name: "Automation",
		icon: Zap,
		description: "Everything above, plus rules and webhooks to automate steps.",
	},
};

const PROFILE_ORDER: readonly EnablementProfile[] = ["checklist", "sop", "automation"];

interface ModePickerProps {
	value: EnablementProfile | null;
	onChange: (next: EnablementProfile) => void;
	disabled?: boolean;
	/** When set, the matching card gets a "Current" pill. For the Configuration page,
	 * which renders the picker against an already-configured org. (Computing "current" from
	 * capability overrides is a separate concern -- callers pass this in if they know.) */
	currentProfile?: EnablementProfile;
}

export function ModePicker({ value, onChange, disabled, currentProfile }: ModePickerProps) {
	return (
		<div className="gap-2 flex flex-col">
			{PROFILE_ORDER.map((profile) => {
				const meta = PROFILE_META[profile];
				const Icon = meta.icon;
				const selected = value === profile;
				const isCurrent = currentProfile === profile;
				return (
					<button
						key={profile}
						type="button"
						disabled={disabled}
						onClick={() => onChange(profile)}
						aria-pressed={selected}
						className={cn(
							"text-left p-4 transition-colors gap-3 flex items-start rounded-lg border",
							selected
								? "border-primary ring-2 ring-primary/20 bg-primary/5"
								: "border-border hover:border-foreground/30",
							disabled && "opacity-50 cursor-not-allowed",
						)}
					>
						<RadioMark selected={selected} />
						<div className="gap-0.5 flex flex-col flex-1 min-w-0">
							<div className="gap-2 flex items-center">
								<Icon
									className={cn(
										"size-4 shrink-0",
										selected ? "text-primary" : "text-foreground/60",
									)}
								/>
								<span className="font-medium text-sm">{meta.name}</span>
								{isCurrent && (
									<span className="px-1.5 py-0.5 text-[10px] rounded font-medium uppercase tracking-wide bg-muted text-muted-foreground">
										Current
									</span>
								)}
							</div>
							<p className="text-xs text-foreground/60 leading-snug">{meta.description}</p>
						</div>
					</button>
				);
			})}
		</div>
	);
}

function RadioMark({ selected }: { selected: boolean }) {
	return (
		<span
			aria-hidden
			className={cn(
				"size-4 shrink-0 rounded-full border-2 mt-0.5 flex items-center justify-center",
				selected ? "border-primary" : "border-border",
			)}
		>
			{selected && <span className="size-2 rounded-full bg-primary" />}
		</span>
	);
}

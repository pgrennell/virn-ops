"use client";

import { orpc } from "@shared/lib/orpc-query-utils";
import { SettingsItem } from "@shared/components/SettingsItem";
import { SettingsList } from "@shared/components/SettingsList";
import { Alert, AlertDescription } from "@virn/ui/components/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@virn/ui/components/alert-dialog";
import { Button } from "@virn/ui/components/button";
import { Input } from "@virn/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@virn/ui/components/select";
import { Skeleton } from "@virn/ui/components/skeleton";
import { Spinner } from "@virn/ui/components/spinner";
import { Switch } from "@virn/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Profiles section
// ---------------------------------------------------------------------------

type EnablementProfile = "checklist" | "sop" | "automation";

const PROFILE_LABELS: Record<EnablementProfile, { name: string; description: string }> = {
	checklist: {
		name: "Checklist",
		description: "Lightweight. Recurring runs + kickoff forms.",
	},
	sop: {
		name: "SOP",
		description: "Adds governance (approvals, acknowledgments, suggestions), public listings, custom fields, guest participants.",
	},
	automation: {
		name: "Automation",
		description: "Everything SOP includes, plus automation rules and outbound webhooks.",
	},
};

function ProfilesSection() {
	const queryClient = useQueryClient();
	const [pending, setPending] = useState<EnablementProfile | null>(null);
	const [result, setResult] = useState<{ profile: EnablementProfile; enabled: number; disabled: number } | null>(null);

	const apply = useMutation(orpc.config.applyProfile.mutationOptions());

	const onApply = async (profile: EnablementProfile) => {
		setPending(profile);
		try {
			const r = await apply.mutateAsync({ profile });
			setResult({ profile, ...r });
			await queryClient.invalidateQueries({ queryKey: orpc.config.listCapabilities.queryKey() });
			await queryClient.invalidateQueries({ queryKey: orpc.config.listSettings.queryKey() });
		} finally {
			setPending(null);
		}
	};

	return (
		<SettingsItem
			title="Enablement profiles"
			description="Bulk-set capabilities to a preset. Switching profile overwrites every profile-managed capability; custom overrides outside profile scope are preserved."
		>
			<div className="gap-3 flex flex-col">
				{(Object.keys(PROFILE_LABELS) as EnablementProfile[]).map((profile) => (
					<AlertDialog key={profile}>
						<AlertDialogTrigger asChild>
							<Button variant="outline" disabled={pending !== null} className="justify-between">
								<span className="flex flex-col items-start">
									<span className="font-medium">{PROFILE_LABELS[profile].name}</span>
									<span className="text-xs text-foreground/60">{PROFILE_LABELS[profile].description}</span>
								</span>
								{pending === profile && <Spinner className="size-4" />}
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Apply {PROFILE_LABELS[profile].name} profile?</AlertDialogTitle>
								<AlertDialogDescription>
									This will enable every capability in the {PROFILE_LABELS[profile].name} preset and disable every other profile-managed capability for this organization. Custom overrides on capabilities outside profile scope are preserved.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction onClick={() => onApply(profile)}>Apply</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				))}
				{result && (
					<Alert>
						<AlertDescription>
							Applied <strong>{PROFILE_LABELS[result.profile].name}</strong>: {result.enabled} enabled, {result.disabled} disabled.
						</AlertDescription>
					</Alert>
				)}
				{apply.isError && (
					<Alert variant="error">
						<AlertDescription>Failed to apply profile: {apply.error.message}</AlertDescription>
					</Alert>
				)}
			</div>
		</SettingsItem>
	);
}

// ---------------------------------------------------------------------------
// Capabilities section
// ---------------------------------------------------------------------------

function CapabilitiesSection() {
	const queryClient = useQueryClient();
	const { data, isLoading, isError, error } = useQuery(orpc.config.listCapabilities.queryOptions());
	const setEnabled = useMutation(orpc.config.setCapabilityEnabled.mutationOptions());
	const clear = useMutation(orpc.config.clearCapability.mutationOptions());

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.config.listCapabilities.queryKey() });

	if (isLoading) {
		return (
			<SettingsItem title="Capabilities" description="Loading...">
				<div className="gap-2 flex flex-col">
					<Skeleton className="w-full h-10" />
					<Skeleton className="w-full h-10" />
					<Skeleton className="w-full h-10" />
				</div>
			</SettingsItem>
		);
	}

	if (isError) {
		return (
			<SettingsItem title="Capabilities" description="Feature toggles for this organization.">
				<Alert variant="error">
					<AlertDescription>Failed to load capabilities: {error.message}</AlertDescription>
				</Alert>
			</SettingsItem>
		);
	}

	return (
		<SettingsItem
			title="Capabilities"
			description="Per-feature toggles. No row in the override table means inherit the platform default."
		>
			<div className="gap-3 flex flex-col">
				{data?.map((cap) => (
					<div key={cap.key} className="gap-3 flex items-start justify-between border-b py-2 last:border-b-0">
						<div className="flex flex-col">
							<div className="flex items-center gap-2">
								<span className="font-medium text-sm">{cap.name}</span>
								<span className="text-xs text-foreground/40 font-mono">{cap.key}</span>
								{cap.isOverridden && (
									<span className="text-xs text-amber-600 dark:text-amber-400">overridden</span>
								)}
							</div>
							{cap.description && (
								<span className="text-xs text-foreground/60 mt-0.5">{cap.description}</span>
							)}
						</div>
						<div className="gap-2 flex items-center shrink-0">
							{cap.isOverridden && (
								<Button
									variant="ghost"
									size="sm"
									disabled={clear.isPending}
									onClick={async () => {
										await clear.mutateAsync({ capabilityKey: cap.key });
										await invalidate();
									}}
								>
									Clear
								</Button>
							)}
							<Switch
								checked={cap.enabled}
								disabled={setEnabled.isPending}
								onCheckedChange={async (next) => {
									await setEnabled.mutateAsync({ capabilityKey: cap.key, enabled: next });
									await invalidate();
								}}
							/>
						</div>
					</div>
				))}
			</div>
		</SettingsItem>
	);
}

// ---------------------------------------------------------------------------
// Settings section
// ---------------------------------------------------------------------------

interface SettingRow {
	id: string;
	key: string;
	name: string;
	description: string | null;
	dataType: "string" | "number" | "boolean" | "json" | "select" | "multiselect";
	category: string | null;
	value: unknown;
	isOverridden: boolean;
	validationSchema: Record<string, unknown> | null;
}

/** Coerce a resolved setting value (jsonb-shaped `unknown`) to a safe input string.
 * Returns "" for null/undefined and for any non-primitive value. */
function asInputString(value: unknown): string {
	if (value == null) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return "";
}

function SettingControl({
	setting,
	onSave,
	onClear,
	isSaving,
}: {
	setting: SettingRow;
	onSave: (value: unknown) => Promise<void>;
	onClear: () => Promise<void>;
	isSaving: boolean;
}) {
	const [draft, setDraft] = useState<unknown>(setting.value);
	const [error, setError] = useState<string | null>(null);
	const hasDraftChange = JSON.stringify(draft) !== JSON.stringify(setting.value);

	// Sync local draft to the resolved setting value whenever the parent's query
	// refetches with new data (e.g., after a successful save or clear-override
	// invalidation). Without this, the local draft retains the previous value and
	// the input visually lags the server until a manual reload. Trade-off: if a
	// user is mid-edit and the parent updates from a parallel source, their
	// in-flight draft is overwritten -- acceptable for single-admin-per-session use.
	useEffect(() => {
		setDraft(setting.value);
	}, [setting.value]);

	const save = async () => {
		setError(null);
		try {
			await onSave(draft);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	const renderInput = () => {
		switch (setting.dataType) {
			case "boolean":
				return (
					<Switch
						checked={Boolean(draft)}
						disabled={isSaving}
						onCheckedChange={async (next) => {
							setDraft(next);
							// Booleans save immediately on toggle.
							try {
								await onSave(next);
							} catch (e) {
								setError(e instanceof Error ? e.message : String(e));
								setDraft(setting.value);
							}
						}}
					/>
				);
			case "select": {
				const options = (setting.validationSchema?.options as string[] | undefined) ?? [];
				return (
					<Select value={asInputString(draft)} onValueChange={(v) => setDraft(v)} disabled={isSaving}>
						<SelectTrigger className="w-56">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{options.map((opt) => (
								<SelectItem key={opt} value={opt}>
									{opt}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				);
			}
			case "number":
				return (
					<Input
						type="number"
						className="w-32"
						value={asInputString(draft)}
						disabled={isSaving}
						onChange={(e) => {
							const v = e.target.value;
							setDraft(v === "" ? null : Number(v));
						}}
					/>
				);
			case "string":
				return (
					<Input
						className="w-72"
						value={asInputString(draft)}
						disabled={isSaving}
						onChange={(e) => setDraft(e.target.value === "" ? null : e.target.value)}
					/>
				);
			default:
				return <span className="text-xs text-foreground/60">Unsupported type: {setting.dataType}</span>;
		}
	};

	const isImmediate = setting.dataType === "boolean";

	return (
		<div className="gap-2 flex flex-col">
			<div className="gap-2 flex items-center">
				{renderInput()}
				{!isImmediate && hasDraftChange && (
					<Button size="sm" onClick={save} disabled={isSaving}>
						Save
					</Button>
				)}
				{setting.isOverridden && (
					<Button
						variant="ghost"
						size="sm"
						disabled={isSaving}
						onClick={async () => {
							setError(null);
							try {
								await onClear();
								// Draft re-syncs to the new (default) setting.value via the
								// useEffect above once the parent's query refetches.
							} catch (e) {
								setError(e instanceof Error ? e.message : String(e));
							}
						}}
					>
						Reset
					</Button>
				)}
			</div>
			{error && <span className="text-xs text-destructive">{error}</span>}
		</div>
	);
}

function SettingsSection() {
	const queryClient = useQueryClient();
	const { data, isLoading, isError, error } = useQuery(orpc.config.listSettings.queryOptions());
	const setSetting = useMutation(orpc.config.setSetting.mutationOptions());
	const clearSetting = useMutation(orpc.config.clearSetting.mutationOptions());

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.config.listSettings.queryKey() });

	const byCategory = useMemo(() => {
		if (!data) return [];
		const map = new Map<string, SettingRow[]>();
		for (const s of data) {
			const cat = s.category ?? "other";
			if (!map.has(cat)) map.set(cat, []);
			map.get(cat)?.push(s as SettingRow);
		}
		return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
	}, [data]);

	if (isLoading) {
		return (
			<SettingsItem title="Settings" description="Loading...">
				<div className="gap-2 flex flex-col">
					<Skeleton className="w-full h-10" />
					<Skeleton className="w-full h-10" />
				</div>
			</SettingsItem>
		);
	}

	if (isError) {
		return (
			<SettingsItem title="Settings" description="Configuration values for this organization.">
				<Alert variant="error">
					<AlertDescription>Failed to load settings: {error.message}</AlertDescription>
				</Alert>
			</SettingsItem>
		);
	}

	if (data?.length === 0) {
		return (
			<SettingsItem title="Settings" description="Configuration values for this organization.">
				<span className="text-sm text-foreground/60">
					No settings available. All defined settings are gated by capabilities currently disabled for this organization.
				</span>
			</SettingsItem>
		);
	}

	return (
		<>
			{byCategory.map(([category, settings]) => (
				<SettingsItem
					key={category}
					title={`Settings — ${category}`}
					description={`Configuration for ${category}.`}
				>
					<div className="gap-4 flex flex-col">
						{settings.map((s) => (
							<div key={s.key} className="gap-2 flex flex-col border-b pb-3 last:border-b-0">
								<div className="flex items-center gap-2">
									<span className="font-medium text-sm">{s.name}</span>
									<span className="text-xs text-foreground/40 font-mono">{s.key}</span>
									{s.isOverridden && (
										<span className="text-xs text-amber-600 dark:text-amber-400">overridden</span>
									)}
								</div>
								{s.description && (
									<span className="text-xs text-foreground/60">{s.description}</span>
								)}
								<SettingControl
									setting={s}
									isSaving={setSetting.isPending || clearSetting.isPending}
									onSave={async (value) => {
										await setSetting.mutateAsync({ settingKey: s.key, value });
										await invalidate();
									}}
									onClear={async () => {
										await clearSetting.mutateAsync({ settingKey: s.key });
										await invalidate();
									}}
								/>
							</div>
						))}
					</div>
				</SettingsItem>
			))}
		</>
	);
}

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

export function OrgConfigurationManagement() {
	return (
		<SettingsList>
			<ProfilesSection />
			<CapabilitiesSection />
			<SettingsSection />
		</SettingsList>
	);
}

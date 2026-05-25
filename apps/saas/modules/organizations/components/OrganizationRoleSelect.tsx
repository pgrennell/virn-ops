import { useOrganizationMemberRoleOptions } from "@organizations/hooks/member-roles";
import type { OrganizationMemberRole } from "@virn/auth";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@virn/ui/components/select";

export function OrganizationRoleSelect({
	value,
	onSelect,
	disabled,
}: {
	value?: OrganizationMemberRole;
	onSelect: (value: OrganizationMemberRole) => void;
	disabled?: boolean;
}) {
	const roleOptions = useOrganizationMemberRoleOptions();

	return (
		<Select value={value} onValueChange={onSelect} disabled={disabled}>
			<SelectTrigger>
				<SelectValue />
			</SelectTrigger>
			<SelectContent className="min-w-72">
				{roleOptions.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						<div className="gap-0.5 py-0.5 flex flex-col text-left">
							<span>{option.label}</span>
							<span className="text-xs leading-snug text-foreground/60">{option.description}</span>
						</div>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

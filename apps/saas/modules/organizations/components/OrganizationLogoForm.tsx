"use client";

import { useActiveOrganization } from "@organizations/hooks/use-active-organization";
import { organizationListQueryKey } from "@organizations/lib/api";
import { authClient } from "@virn/auth/client";
import { Spinner } from "@virn/ui";
import { toastError, toastSuccess } from "@virn/ui/components/toast";
import { SettingsItem } from "@shared/components/SettingsItem";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { type HTMLAttributes, useState } from "react";
import { useDropzone } from "react-dropzone";

import { CropImageDialog } from "../../settings/components/CropImageDialog";
import { OrganizationLogo } from "./OrganizationLogo";

export function OrganizationLogoForm() {
	const t = useTranslations();
	const [uploading, setUploading] = useState(false);
	const [cropDialogOpen, setCropDialogOpen] = useState(false);
	const [image, setImage] = useState<File | null>(null);
	const { activeOrganization, refetchActiveOrganization } = useActiveOrganization();
	const queryClient = useQueryClient();
	const getSignedUploadUrlMutation = useMutation(
		orpc.organizations.createLogoUploadUrl.mutationOptions(),
	);

	const { getRootProps, getInputProps } = useDropzone({
		onDrop: (acceptedFiles) => {
			setImage(acceptedFiles[0]);
			setCropDialogOpen(true);
		},
		accept: {
			"image/png": [".png"],
			"image/jpeg": [".jpg", ".jpeg"],
		},
		multiple: false,
	});

	if (!activeOrganization) {
		return null;
	}

	const onCrop = async (croppedImageData: Blob | null) => {
		if (!croppedImageData) {
			return;
		}

		setUploading(true);
		try {
			// Org id is read from session context server-side (adminOrgProcedure) —
			// no input field needed. See AUTH_CONTRACT.md §3.1.
			const { signedUploadUrl, path } = await getSignedUploadUrlMutation.mutateAsync({});

			const response = await fetch(signedUploadUrl, {
				method: "PUT",
				body: croppedImageData,
				headers: {
					"Content-Type": "image/png",
				},
			});

			if (!response.ok) {
				throw new Error("Failed to upload image");
			}

			const { error } = await authClient.organization.update({
				organizationId: activeOrganization.id,
				data: {
					logo: path,
				},
			});

			if (error) {
				throw error;
			}

			toastSuccess(t("settings.account.avatar.notifications.success"));

			await refetchActiveOrganization();

			await queryClient.invalidateQueries({
				queryKey: organizationListQueryKey,
			});
		} catch {
			toastError(t("settings.account.avatar.notifications.error"));
		} finally {
			setUploading(false);
		}
	};

	return (
		<SettingsItem
			title={t("organizations.settings.logo.title")}
			description={t("organizations.settings.logo.description")}
		>
			<div
				className="size-24 relative rounded-full"
				{...(getRootProps() as HTMLAttributes<HTMLDivElement>)}
			>
				<input {...getInputProps()} />
				<OrganizationLogo
					className="size-24 text-xl cursor-pointer"
					logoUrl={activeOrganization.logo}
					name={activeOrganization.name ?? ""}
				/>

				{uploading && (
					<div className="inset-0 absolute z-20 flex items-center justify-center bg-card/90">
						<Spinner />
					</div>
				)}
			</div>

			<CropImageDialog
				image={image}
				open={cropDialogOpen}
				onOpenChange={setCropDialogOpen}
				onCrop={onCrop}
			/>
		</SettingsItem>
	);
}

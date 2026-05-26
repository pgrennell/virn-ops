import { getSession } from "@auth/lib/server";
import { Button } from "@virn/ui/components/button";
import { AccountShell } from "@shared/components/AccountShell";
import { SIDEBAR_COLLAPSED_COOKIE } from "@shared/lib/sidebar-context";
import { ArrowLeftIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import Link from "next/link";

export default async function NotFoundPage() {
	const t = await getTranslations("notFound");
	const session = await getSession();
	const cookieStore = await cookies();
	const initialCollapsed = cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === "true";
	const isPlatformAdmin = session?.user?.role === "admin";

	return (
		<AccountShell isPlatformAdmin={isPlatformAdmin} initialCollapsed={initialCollapsed}>
			<div className="flex h-full flex-col items-center justify-center">
				<h1 className="font-bold text-5xl">{t("code")}</h1>
				<p className="mt-2 text-2xl">{t("title")}</p>

				<Button asChild className="mt-4">
					<Link href="/">
						<ArrowLeftIcon className="mr-2 size-4" /> {t("goToDashboard")}
					</Link>
				</Button>
			</div>
		</AccountShell>
	);
}

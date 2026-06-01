// @vitest-environment jsdom
//
// CreateOrganizationForm -- Phase 19 org provisioning. The behaviour under test is the
// org-creation success path: after a successful create + setActive, it pre-installs the
// property-ops starter pack (best-effort) and then forwards to the mode picker. We mock the
// create mutation, active-org switch, router, orpc client, query client, and i18n so we can
// pin: (1) the happy-path ordering (create -> setActive -> installStarterContent -> redirect),
// and (2) the best-effort contract -- a failing install must NOT block the redirect or surface
// an error toast.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factories (which are hoisted above normal consts) can reference them.
const { mutateAsync, setActiveOrganization, invalidateQueries, replace, installStarterContent, toastError } =
	vi.hoisted(() => ({
		mutateAsync: vi.fn(),
		setActiveOrganization: vi.fn(),
		invalidateQueries: vi.fn(),
		replace: vi.fn(),
		installStarterContent: vi.fn(),
		toastError: vi.fn(),
	}));

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("@organizations/lib/api", () => ({
	organizationListQueryKey: ["organization-list"],
	useCreateOrganizationMutation: () => ({ mutateAsync }),
}));
vi.mock("@organizations/hooks/use-active-organization", () => ({
	useActiveOrganization: () => ({ setActiveOrganization }),
}));
vi.mock("@shared/hooks/router", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@shared/lib/orpc-client", () => ({
	orpcClient: { packs: { installStarterContent } },
}));
vi.mock("@tanstack/react-query", async (orig) => ({
	...(await orig<typeof import("@tanstack/react-query")>()),
	useQueryClient: () => ({ invalidateQueries }),
}));
vi.mock("@virn/ui/components/toast", () => ({ toastError }));

import { CreateOrganizationForm } from "./CreateOrganizationForm";

let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	mutateAsync.mockResolvedValue({ slug: "acme" });
	setActiveOrganization.mockResolvedValue(undefined);
	invalidateQueries.mockResolvedValue(undefined);
	installStarterContent.mockResolvedValue({});
	errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	cleanup();
	errSpy.mockRestore();
	vi.clearAllMocks();
});

function submitWithName(name: string) {
	const { container } = render(<CreateOrganizationForm />);
	fireEvent.change(screen.getByRole("textbox"), { target: { value: name } });
	fireEvent.submit(container.querySelector("form") as HTMLFormElement);
}

describe("CreateOrganizationForm provisioning", () => {
	it("pre-installs the starter pack after setActive, then redirects to the mode picker", async () => {
		submitWithName("Acme Property Co");

		await waitFor(() =>
			expect(replace).toHaveBeenCalledWith("/new-organization/mode"),
		);

		expect(installStarterContent).toHaveBeenCalledWith({});
		// Ordering: create -> setActive -> install -> redirect.
		expect(setActiveOrganization.mock.invocationCallOrder[0]).toBeLessThan(
			installStarterContent.mock.invocationCallOrder[0],
		);
		expect(installStarterContent.mock.invocationCallOrder[0]).toBeLessThan(
			replace.mock.invocationCallOrder[0],
		);
		expect(toastError).not.toHaveBeenCalled();
	});

	it("is best-effort: a failed install still redirects and shows no error toast", async () => {
		installStarterContent.mockRejectedValue(new Error("PACK_NOT_SEEDED"));

		submitWithName("Acme Property Co");

		await waitFor(() =>
			expect(replace).toHaveBeenCalledWith("/new-organization/mode"),
		);
		expect(toastError).not.toHaveBeenCalled();
	});

	it("does not install or redirect when org creation itself fails", async () => {
		mutateAsync.mockRejectedValue(new Error("create failed"));

		submitWithName("Acme Property Co");

		await waitFor(() => expect(toastError).toHaveBeenCalled());
		expect(installStarterContent).not.toHaveBeenCalled();
		expect(replace).not.toHaveBeenCalled();
	});
});

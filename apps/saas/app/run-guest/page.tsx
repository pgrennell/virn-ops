import { GuestRunView } from "@runs/components/GuestRunView";

// Standalone, session-agnostic page for tokenized guest access (UX_SPEC §5.4, Phase 3.5).
// The token lives in the URL fragment (`/run-guest/#token=...`) so it never hits server
// access logs, browser history, or referrer headers. Fragments are NOT sent in HTTP
// requests — the client reads it on mount and POSTs it in the request body.
//
// No auth wrapper. No org context. The procedure layer rate-limits by IP and enforces
// scope via the participant_token row.

export const dynamic = "force-dynamic";

export default function RunGuestPage() {
	return (
		<main className="min-h-screen bg-background">
			<GuestRunView />
		</main>
	);
}

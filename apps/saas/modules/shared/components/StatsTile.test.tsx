// @vitest-environment jsdom
//
// StatsTile -- a metric card. Its logic is the value-format selection (currency / percentage /
// plain number) and the trend treatment (a signed percent with a +/- prefix, in a success or
// error badge, omitted entirely when there is no trend). We mock next-intl's useFormatter to a
// transparent "<style>:<value>" stub (so we can see WHICH format style was chosen) and the
// locale-currency hook. Two mocks.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
	useFormatter: () => ({
		number: (v: number, opts?: { style?: string }) => `${opts?.style ?? "plain"}:${v}`,
	}),
}));
vi.mock("@shared/hooks/locale-currency", () => ({
	useLocaleCurrency: () => "USD",
}));

import { StatsTile } from "./StatsTile";

afterEach(cleanup);

describe("StatsTile value formatting", () => {
	it("formats a currency value with the currency style", () => {
		render(<StatsTile title="Revenue" value={1000} valueFormat="currency" />);
		expect(screen.getByText("currency:1000")).toBeInTheDocument();
	});

	it("formats a percentage value with the percent style", () => {
		render(<StatsTile title="Occupancy" value={0.5} valueFormat="percentage" />);
		expect(screen.getByText("percent:0.5")).toBeInTheDocument();
	});

	it("formats a plain number with no style", () => {
		render(<StatsTile title="Units" value={42} valueFormat="number" />);
		expect(screen.getByText("plain:42")).toBeInTheDocument();
	});
});

describe("StatsTile trend + extras", () => {
	it("renders a positive trend with a + prefix", () => {
		render(<StatsTile title="Revenue" value={1000} valueFormat="currency" trend={0.1} />);
		expect(screen.getByText("+percent:0.1")).toBeInTheDocument();
	});

	it("renders a negative trend without a + prefix", () => {
		render(<StatsTile title="Revenue" value={1000} valueFormat="currency" trend={-0.1} />);
		expect(screen.getByText("percent:-0.1")).toBeInTheDocument();
	});

	it("renders no trend badge when no trend is given", () => {
		render(<StatsTile title="Revenue" value={1000} valueFormat="currency" />);
		expect(screen.queryByText(/percent:/)).not.toBeInTheDocument();
	});

	it("renders the context suffix and children", () => {
		render(
			<StatsTile title="Revenue" value={1000} valueFormat="currency" context="/mo">
				<div>chart</div>
			</StatsTile>,
		);
		expect(screen.getByText("/mo")).toBeInTheDocument();
		expect(screen.getByText("chart")).toBeInTheDocument();
	});
});

import type { ReactNode } from "react";
import { cn } from "../lib";

export type ProductKey = "ops" | "pm";

type ProductConfig = {
	icon: (props: { badgeSrc?: string }) => ReactNode;
	leadingText: string;
	trailingText: string;
};

// "Virn" stays neutral, the product half ("Ops"/"PM") carries the emphasis so the
// reader's eye lands on the disambiguating word. Icon and wordmark live together
// here so every consumer (sidebar, marketing nav, docs, mail, admin) gets a
// coherent identity by passing the same product key.
const PRODUCTS: Record<ProductKey, ProductConfig> = {
	ops: {
		icon: ({ badgeSrc }) => <OpsBadge badgeSrc={badgeSrc} />,
		leadingText: "Virn",
		trailingText: "Ops",
	},
	pm: {
		icon: () => <StackedTilesIcon id="virn-pm" letters={<PmLetters />} />,
		leadingText: "Virn",
		trailingText: "PM",
	},
};

export function Logo({
	product = "ops",
	withLabel = true,
	className,
	badgeSrc,
}: {
	product?: ProductKey;
	withLabel?: boolean;
	className?: string;
	// Optional override for the badge image URL. Web consumers can omit (the
	// default relative path resolves against each app's public/ dir); mail
	// templates must pass an absolute URL since email clients can't fetch
	// relative paths.
	badgeSrc?: string;
}) {
	const { icon, leadingText, trailingText } = PRODUCTS[product];
	const label = `${leadingText} ${trailingText}`;
	return (
		<span
			className={cn(
				"font-semibold flex items-center leading-none text-foreground",
				className,
			)}
			aria-label={label}
		>
			{icon({ badgeSrc })}
			{withLabel && (
				<span className="ml-3 text-lg tracking-tight flex items-baseline gap-1.5">
					<span className="font-medium text-foreground">{leadingText}</span>
					<span className="font-semibold text-primary">{trailingText}</span>
				</span>
			)}
		</span>
	);
}

// Ops badge is a designed PNG (gradient hex with the "virn OPS" wordmark baked
// in). Same image is duplicated under apps/{saas,marketing,docs}/public/brand/
// so the relative path resolves consistently across Next apps.
function OpsBadge({ badgeSrc }: { badgeSrc?: string }) {
	return (
		<img
			src={badgeSrc ?? "/brand/virn-ops-logo.png"}
			alt=""
			width={48}
			height={48}
			className="size-12 shrink-0"
		/>
	);
}

// PM keeps the geometric stacked-tile mark until a designed badge exists. Three
// isometric tiles (32% / 48% / 100% opacity) with "PM" painted on the front
// tile in fill-background so the letters flip with the theme.
function StackedTilesIcon({
	id,
	letters,
}: {
	id: string;
	letters: ReactNode;
}) {
	const tileId = `${id}-tile`;
	return (
		<svg
			className="size-12 shrink-0"
			style={{ color: "#4FBFC9" }}
			viewBox="80 85 340 290"
			shapeRendering="geometricPrecision"
		>
			<title>Virn</title>
			<defs>
				<path
					id={tileId}
					d="M 37.71 -73.93 L 132.29 -21.07 Q 170 0 132.29 21.07 L 37.71 73.93 Q 0 95 -37.71 73.93 L -132.29 21.07 Q -170 0 -132.29 -21.07 L -37.71 -73.93 Q 0 -95 37.71 -73.93 Z"
				/>
			</defs>
			<use
				href={`#${tileId}`}
				x="250"
				y="280"
				fill="currentColor"
				opacity="0.32"
			/>
			<use
				href={`#${tileId}`}
				x="250"
				y="230"
				fill="currentColor"
				opacity="0.48"
			/>
			<use href={`#${tileId}`} x="250" y="180" fill="currentColor" />
			{letters}
		</svg>
	);
}

function PmLetters() {
	return (
		<g
			className="fill-background"
			fillRule="evenodd"
			transform="translate(250 180) scale(0.525) translate(-249.5 -260.5) translate(0 500) scale(0.1 -0.1)"
		>
			<path d="M949 2934 c-12 -14 -14 -108 -17 -534 -2 -328 1 -527 7 -544 l11 -26 129 0 c119 0 131 2 141 19 5 11 10 84 10 165 l0 146 348 0 c281 0 359 3 407 15 169 44 224 152 212 421 -6 158 -23 211 -84 271 -80 77 -79 77 -649 81 -460 2 -502 1 -515 -14z m905 -258 c44 -18 60 -66 53 -154 -9 -111 8 -106 -362 -110 l-315 -3 0 141 0 140 295 0 c231 0 303 -3 329 -14z" />
			<path d="M2420 2933 c-71 -36 -70 -29 -70 -583 0 -373 3 -499 12 -508 8 -8 51 -12 128 -12 77 0 120 4 128 12 9 9 12 116 12 420 0 396 1 408 19 408 20 0 39 -45 252 -590 82 -212 117 -242 285 -248 55 -2 119 1 142 8 48 12 105 59 129 104 9 17 78 186 153 376 118 300 138 345 158 348 l22 3 0 -408 c0 -305 3 -412 12 -421 8 -8 51 -12 130 -12 108 0 118 2 128 20 8 15 10 170 8 513 -3 453 -4 495 -21 525 -29 53 -64 62 -249 62 -178 0 -212 -8 -251 -61 -10 -14 -83 -199 -162 -410 -140 -377 -143 -384 -171 -387 l-29 -2 -138 368 c-147 391 -166 433 -210 466 -26 19 -44 21 -205 24 -154 2 -182 0 -212 -15z" />
		</g>
	);
}

// Linkify -- render plain (user-authored) text with bare http(s) URLs turned into safe,
// clickable external links. Used for step/workflow instructions, which are plain text in v1
// (Phase 19 gap #10 scope = links only; markdown / images / tables deferred to v1.1). Parents
// keep their `whitespace-pre-wrap`, so newlines + spacing are preserved -- this only swaps URL
// runs for <a> elements and leaves everything else as text.

import { Fragment } from "react";

// Split keeps the URL delimiters (capturing group); IS_URL is anchored + non-global so testing
// a part is stateless (avoids the lastIndex foot-gun of reusing a /g regex with .test()).
const URL_SPLIT = /(https?:\/\/[^\s]+)/g;
const IS_URL = /^https?:\/\/[^\s]+$/;

export function Linkify({ text }: { text: string }) {
	const parts = text.split(URL_SPLIT);
	return (
		<>
			{parts.map((part, i) =>
				IS_URL.test(part) ? (
					<a
						key={i}
						href={part}
						target="_blank"
						rel="noopener noreferrer nofollow"
						className="text-primary underline underline-offset-2 hover:text-primary/80 break-words"
					>
						{part}
					</a>
				) : (
					<Fragment key={i}>{part}</Fragment>
				),
			)}
		</>
	);
}

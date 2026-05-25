import { cn } from "@virn/ui";

export function Footer() {
	return (
		<footer className={cn("max-w-6xl py-6 text-xs container text-center text-foreground/60")}>
			<span>© {new Date().getFullYear()} Virn</span>
		</footer>
	);
}

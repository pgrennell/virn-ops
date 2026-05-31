import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
	// Use the React 17+ automatic JSX runtime so component test files (.test.tsx) don't
	// need to `import React` -- matches how Next.js compiles the app.
	esbuild: { jsx: "automatic" },
	test: {
		globals: true,
		// Default to the fast node env; component/hook tests opt into jsdom per-file via a
		// `// @vitest-environment jsdom` docblock (keeps the pure-logic suite node-fast and
		// leaves the existing tests untouched).
		environment: "node",
		// Registers @testing-library/jest-dom matchers (toBeInTheDocument, etc.). Safe to
		// load in node-env tests -- it only extends `expect`; the matchers reach into the
		// DOM only when called, which happens exclusively inside jsdom-env test files.
		setupFiles: ["./vitest.setup.ts"],
		exclude: ["**/node_modules/**", "**/tests/**", "**/.next/**"],
	},
	resolve: {
		alias: {
			"@config": path.resolve(import.meta.dirname, "./config"),
			"@shared": path.resolve(import.meta.dirname, "./modules/shared"),
			"@auth": path.resolve(import.meta.dirname, "./modules/auth"),
			"@organizations": path.resolve(import.meta.dirname, "./modules/organizations"),
			"@payments": path.resolve(import.meta.dirname, "./modules/payments"),
			"@i18n": path.resolve(import.meta.dirname, "./modules/i18n"),
			"@admin": path.resolve(import.meta.dirname, "./modules/admin"),
			"@ai": path.resolve(import.meta.dirname, "./modules/ai"),
			"@onboarding": path.resolve(import.meta.dirname, "./modules/onboarding"),
			"@settings": path.resolve(import.meta.dirname, "./modules/settings"),
			"@runs": path.resolve(import.meta.dirname, "./modules/runs"),
			"@builder": path.resolve(import.meta.dirname, "./modules/builder"),
			"@library": path.resolve(import.meta.dirname, "./modules/library"),
		},
	},
});

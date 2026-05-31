// Vitest global setup for the saas app.
//
// Registers @testing-library/jest-dom's custom matchers (toBeInTheDocument,
// toHaveTextContent, toBeDisabled, ...) on `expect`. This runs for every test file,
// but it only EXTENDS expect -- it does not touch the DOM at load time, so it is safe
// in the default node environment. Component/hook test files opt into a DOM by adding
//   // @vitest-environment jsdom
// at the top of the file (and call @testing-library/react's `cleanup` in an afterEach).

import "@testing-library/jest-dom/vitest";

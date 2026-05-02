/**
 * Vitest setup file — extends `expect` with jest-dom matchers
 * (`toBeInTheDocument`, `toHaveAttribute`, etc.) for the jsdom-backed
 * premium primitive render tests. The setup is harmless for the
 * default node-environment files: `expect` simply gains extra matchers
 * that go unused there.
 */
import "@testing-library/jest-dom/vitest";

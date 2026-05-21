// @vitest-environment jsdom
// Task #481 — fast component coverage for the non-admin
// /getting-started early-return added in #479 (and locked in by the
// slower Playwright spec in #480). Mounts GettingStartedPage with a
// stubbed useAuth() for each role and asserts the right surface
// renders without spinning up the full app shell or hitting the API.
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, cleanup, screen } from "@testing-library/react";

const authStub: { user: { role: string; firstName?: string } | null } = {
  user: null,
};

vi.mock("@/lib/auth", () => ({
  useAuth: () => authStub,
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/getting-started", () => {}],
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
  useMutation: () => ({ mutate: () => {}, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: () => {} }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: async () => ({ json: async () => ({}) }),
  queryClient: { invalidateQueries: () => {} },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => {} }),
}));

vi.mock("@/lib/use-document-title", () => ({
  useDocumentTitle: () => {},
}));

import GettingStartedPage from "@/pages/getting-started";

afterEach(() => {
  cleanup();
  authStub.user = null;
});

describe("GettingStartedPage role gating (Task 481 / #479 regression)", () => {
  for (const role of ["MANAGER", "TEAM_MEMBER"] as const) {
    it(`${role} sees the non-admin panel, not the admin Mission Control shell`, () => {
      authStub.user = { role, firstName: "Test" };

      render(<GettingStartedPage />);

      expect(screen.getByTestId("getting-started-non-admin")).toBeInTheDocument();
      expect(screen.queryByTestId("text-mission-control-title")).toBeNull();
    });
  }

  it("ADMIN sees the Mission Control shell, not the non-admin panel", () => {
    authStub.user = { role: "ADMIN", firstName: "Test" };

    render(<GettingStartedPage />);

    expect(screen.getByTestId("text-mission-control-title")).toBeInTheDocument();
    expect(screen.queryByTestId("getting-started-non-admin")).toBeNull();
  });
});

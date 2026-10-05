// @vitest-environment jsdom
// Send dialog default recipients (PR #83 red-team). The billing contacts the
// server would CC must never be dropped silently: not by sending before the
// contacts load, not by org settings arriving late, not by a failed load.
import { describe, it, expect, afterEach } from "vitest";
import { createElement } from "react";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SendEmailModal } from "@/components/shared/send-email-modal";

type Sent = { to: string; cc?: string[]; subject: string; body: string };

function setup(contacts: () => Promise<unknown>, cached?: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { queryFn: contacts, retry: false, gcTime: 60_000 } } });
  if (cached !== undefined) client.setQueryData(["/api/clients", "c1", "contacts"], cached);
  const sends: Sent[] = [];
  const props = {
    open: true, onClose: () => {}, onSend: (d: Sent) => sends.push(d), isPending: false,
    type: "invoice" as const, number: "INV1", clientName: "ACME", clientEmail: "client@example.com",
    clientId: "c1", orgName: "Org", total: "100",
  };
  const el = (p: typeof props) => createElement(QueryClientProvider, { client }, createElement(SendEmailModal, p));
  const ui = render(el(props));
  return { ui, sends, rerender: (over: Partial<typeof props>) => ui.rerender(el({ ...props, ...over })), client };
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

afterEach(() => cleanup());

describe("SendEmailModal default recipients", () => {
  it("can't send until the contacts load, then CCs the billing contact", async () => {
    let resolve!: (v: unknown) => void;
    const { ui, sends } = setup(() => new Promise((r) => { resolve = r; }));
    expect((ui.getByTestId("button-confirm-send") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(ui.getByTestId("button-confirm-send"));
    expect(sends).toHaveLength(0);

    await act(async () => { resolve([{ id: "ap", email: "ap@example.com", role: "billing", isPrimary: false }]); });
    await flush();
    fireEvent.click(ui.getByTestId("button-confirm-send"));
    expect(sends[0].to).toBe("client@example.com");
    expect(sends[0].cc).toEqual(["ap@example.com"]);
  });

  it("keeps the billing CC when org settings arrive after the contacts", async () => {
    const { ui, rerender } = setup(async () => [{ id: "ap", email: "ap@example.com", role: "billing", isPrimary: false }]);
    await flush();
    expect(ui.getByTestId("recipient-list").textContent).toContain("ap@example.com");
    rerender({ orgName: "Actual loaded org" });
    await flush();
    expect(ui.getByTestId("recipient-list").textContent).toContain("ap@example.com");
  });

  it("a failed contacts load leaves CC to the server's billing defaults", async () => {
    const { ui, sends } = setup(async () => { throw new Error("boom"); });
    await flush();
    expect(ui.getByTestId("text-contacts-failed")).toBeTruthy();
    fireEvent.click(ui.getByTestId("button-confirm-send"));
    expect(sends[0].to).toBe("client@example.com");
    expect(sends[0].cc).toBeUndefined();
  });

  it("a stale cached contact list is replaced by the fresh one before Send unlocks", async () => {
    let resolve!: (v: unknown) => void;
    const { ui, sends } = setup(() => new Promise((r) => { resolve = r; }), []);
    expect((ui.getByTestId("button-confirm-send") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { resolve([{ id: "ap", email: "ap@example.com", role: "billing", isPrimary: false }]); });
    await flush();
    fireEvent.click(ui.getByTestId("button-confirm-send"));
    expect(sends[0].cc).toEqual(["ap@example.com"]);
  });
});

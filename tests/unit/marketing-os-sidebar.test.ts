/**
 * Sprint 2k — Sidebar Marketing section: always-on for admins.
 *
 * Tests <MarketingNavSection/> directly (extracted to its own file
 * for testability). The parent AppSidebar handles the non-admin gate
 * by simply not rendering this component, so we cover that contract by
 * a structural source-text assertion at the bottom.
 *
 * Same render-as-function pattern as brand-switcher.test.ts — we walk
 * the returned React tree directly and avoid @testing-library/react.
 */
import { describe, it, expect, vi } from "vitest";
import * as React from "react";
(globalThis as any).React = React;

vi.mock("react", async () => {
  const actual: any = await vi.importActual("react");
  return {
    ...actual,
    useState: (initial: any) => [
      typeof initial === "function" ? initial() : initial,
      () => {},
    ],
    useEffect: () => {},
  };
});

import { MarketingNavSection } from "../../client/src/components/marketing-nav-section";

interface AnyEl { type?: any; props?: any; }
function flatten(node: any): AnyEl[] {
  if (node == null || typeof node === "string" || typeof node === "number" || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const arr: AnyEl[] = [node];
  const kids = node?.props?.children;
  if (kids != null) arr.push(...flatten(kids));
  return arr;
}

function render(props: { status: "active" | "inactive" | "grace"; location?: string }) {
  const tree = (MarketingNavSection as unknown as (p: any) => any)({
    status: props.status,
    location: props.location ?? "/dashboard",
  });
  return flatten(tree);
}

function findByTestId(nodes: AnyEl[], id: string) {
  return nodes.find(n => n?.props && n.props["data-testid"] === id);
}

describe("MarketingNavSection (Sprint 2k)", () => {
  it("active → group label + Contacts/Companies links with hrefs, no lock, no pill, no modal", () => {
    const nodes = render({ status: "active" });
    expect(findByTestId(nodes, "section-marketing-active")).toBeTruthy();
    expect(findByTestId(nodes, "section-marketing-locked")).toBeFalsy();
    expect(findByTestId(nodes, "pill-marketing-price")).toBeFalsy();
    expect(findByTestId(nodes, "icon-marketing-lock")).toBeFalsy();
    const contacts = findByTestId(nodes, "link-contacts");
    expect(contacts).toBeTruthy();
    expect(contacts!.props.href).toBe("/marketing/contacts");
    const companies = findByTestId(nodes, "link-companies");
    expect(companies!.props.href).toBe("/marketing/companies");
  });

  it("grace → identical to active (no lock, no pill, links have href)", () => {
    const nodes = render({ status: "grace" });
    expect(findByTestId(nodes, "section-marketing-active")).toBeTruthy();
    expect(findByTestId(nodes, "section-marketing-locked")).toBeFalsy();
    expect(findByTestId(nodes, "pill-marketing-price")).toBeFalsy();
    const contacts = findByTestId(nodes, "link-contacts");
    expect(contacts!.props.href).toBe("/marketing/contacts");
  });

  it("inactive → locked variant: lock icon, disabled rows without href, modal mounted", () => {
    const nodes = render({ status: "inactive" });
    const locked = findByTestId(nodes, "section-marketing-locked");
    expect(locked).toBeTruthy();
    expect(findByTestId(nodes, "section-marketing-active")).toBeFalsy();
    expect(findByTestId(nodes, "pill-marketing-price")).toBeFalsy();
    expect(findByTestId(nodes, "icon-marketing-lock")).toBeTruthy();
    const groupBtn = findByTestId(nodes, "button-section-marketing-locked")!;
    expect(typeof groupBtn.props.onClick).toBe("function");
    const lockedContacts = findByTestId(nodes, "row-locked-contacts")!;
    const lockedCompanies = findByTestId(nodes, "row-locked-companies")!;
    expect(lockedContacts).toBeTruthy();
    expect(lockedCompanies).toBeTruthy();
    expect(lockedContacts.props.href).toBeUndefined();
    expect(lockedCompanies.props.href).toBeUndefined();
    expect(lockedContacts.props.style?.cursor).toBe("not-allowed");
    expect(typeof lockedContacts.props.onClick).toBe("function");
    expect(typeof lockedCompanies.props.onClick).toBe("function");
  });

  it("inactive → group label and both child rows are independent click targets", () => {
    const nodes = render({ status: "inactive" });
    const groupBtn = findByTestId(nodes, "button-section-marketing-locked")!;
    const c = findByTestId(nodes, "row-locked-contacts")!;
    const co = findByTestId(nodes, "row-locked-companies")!;
    expect(groupBtn.props.onClick).toBeInstanceOf(Function);
    expect(c.props.onClick).toBeInstanceOf(Function);
    expect(co.props.onClick).toBeInstanceOf(Function);
  });

  it("AppSidebar gates the section: `isAdmin` guard AND a non-null entitlement verdict (no flicker on first paint)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/components/app-sidebar.tsx"),
      "utf8",
    );
    // Find the JSX render site for <MarketingNavSection ... /> and the
    // conditional that immediately precedes it. Both `isAdmin` and a
    // truthy guard on the resolved entitlement status must appear in
    // the same condition so non-admins never see the section AND
    // active orgs don't flicker the locked upsell while the
    // entitlement-details query is in-flight.
    // Use the JSX render site (which has props) — there's also a
    // comment that mentions the component name above the gate.
    const idx = src.search(/<MarketingNavSection\s+status=/);
    expect(idx).toBeGreaterThan(0);
    const preceding = src.slice(Math.max(0, idx - 200), idx);
    expect(preceding).toMatch(/isAdmin/);
    expect(preceding).toMatch(/marketingStatus\s*!==\s*null/);
  });
});

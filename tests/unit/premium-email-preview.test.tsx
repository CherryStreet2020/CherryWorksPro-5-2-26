// @vitest-environment jsdom
/**
 * EmailPreview render tests (task #150).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { EmailPreview } from "@/components/marketing-os/premium/email-preview";

afterEach(cleanup);

describe("EmailPreview (render)", () => {
  it("renders the From line, subject, body, and CTA label", () => {
    render(
      <EmailPreview
        fromName="Mira from CherryWorks"
        fromEmail="mira@cherryworks.app"
        subject="Quick check-in"
        body="Following up on our chat."
        ctaLabel="Book a 15-min call"
        signatureName="Mira Patel"
        signatureTitle="Customer Success"
      />,
    );
    expect(screen.getByTestId("premium-email-preview")).toBeInTheDocument();
    expect(screen.getByText("Mira from CherryWorks")).toBeInTheDocument();
    expect(screen.getByText(/mira@cherryworks\.app/)).toBeInTheDocument();
    expect(screen.getByText("Quick check-in")).toBeInTheDocument();
    expect(screen.getByText("Following up on our chat.")).toBeInTheDocument();
    expect(screen.getByText("Book a 15-min call")).toBeInTheDocument();
    expect(screen.getByText("Mira Patel")).toBeInTheDocument();
    expect(screen.getByText("Customer Success")).toBeInTheDocument();
  });

  it("uses an anchor for the CTA so it visually reads as a button-link", () => {
    render(<EmailPreview ctaLabel="Tap me" />);
    const cta = screen.getByText("Tap me");
    expect(cta.tagName).toBe("A");
    expect(cta).toHaveAttribute("href", "#");
  });

  it("applies the custom primaryColor as the CTA background", () => {
    render(<EmailPreview ctaLabel="Go" primaryColor="rgb(255, 0, 0)" />);
    const cta = screen.getByText("Go") as HTMLAnchorElement;
    expect(cta.style.background).toContain("rgb(255, 0, 0)");
  });
});

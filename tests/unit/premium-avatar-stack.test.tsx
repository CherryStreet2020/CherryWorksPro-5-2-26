// @vitest-environment jsdom
/**
 * AvatarStack render tests (task #150).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AvatarStack } from "@/components/marketing-os/premium/avatar-stack";

afterEach(cleanup);

describe("AvatarStack (render)", () => {
  it("renders one chip per visible person up to `max`", () => {
    render(
      <AvatarStack
        people={[
          { name: "Ada Lovelace" },
          { name: "Grace Hopper" },
          { name: "Linus Torvalds" },
        ]}
        max={4}
      />,
    );
    expect(screen.getByTestId("premium-avatar-stack")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-0")).toHaveTextContent("AL");
    expect(screen.getByTestId("avatar-1")).toHaveTextContent("GH");
    expect(screen.getByTestId("avatar-2")).toHaveTextContent("LT");
    expect(screen.queryByTestId("avatar-overflow")).not.toBeInTheDocument();
  });

  it("renders +N overflow chip when people exceed `max`", () => {
    render(
      <AvatarStack
        people={[
          { name: "A B" },
          { name: "C D" },
          { name: "E F" },
          { name: "G H" },
          { name: "I J" },
          { name: "K L" },
        ]}
        max={3}
      />,
    );
    const overflow = screen.getByTestId("avatar-overflow");
    expect(overflow).toBeInTheDocument();
    expect(overflow).toHaveTextContent("+3");
  });

  it("uses an <img> with alt text when imageUrl is provided", () => {
    render(
      <AvatarStack
        people={[{ name: "Mira Patel", imageUrl: "https://example.com/m.png" }]}
      />,
    );
    const img = screen.getByAltText("Mira Patel") as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.tagName).toBe("IMG");
    expect(img).toHaveAttribute("src", "https://example.com/m.png");
  });

  it("sets a `title` tooltip on each chip for keyboard/pointer hover", () => {
    render(<AvatarStack people={[{ name: "Mira Patel" }]} />);
    expect(screen.getByTitle("Mira Patel")).toBeInTheDocument();
  });
});

import { describe, it, expect } from "vitest";
import { computeMinutesFromTimes } from "../../shared/schema";
import { formatTime12h } from "../../client/src/components/shared/format";

describe("computeMinutesFromTimes", () => {
  it("computes simple morning block", () => {
    expect(computeMinutesFromTimes("09:00", "12:00")).toBe(180);
  });

  it("computes 1-hour block", () => {
    expect(computeMinutesFromTimes("14:00", "15:00")).toBe(60);
  });

  it("handles overnight wrap (end < start)", () => {
    expect(computeMinutesFromTimes("22:00", "02:00")).toBe(240);
  });

  it("handles midnight to early morning", () => {
    expect(computeMinutesFromTimes("23:30", "00:30")).toBe(60);
  });

  it("handles full day", () => {
    expect(computeMinutesFromTimes("08:00", "17:00")).toBe(540);
  });

  it("handles 5-minute block", () => {
    expect(computeMinutesFromTimes("09:00", "09:05")).toBe(5);
  });

  it("handles half-hour block", () => {
    expect(computeMinutesFromTimes("10:15", "10:45")).toBe(30);
  });
});

describe("formatTime12h", () => {
  it("formats morning time", () => {
    expect(formatTime12h("09:00")).toBe("9:00 AM");
  });

  it("formats afternoon time", () => {
    expect(formatTime12h("14:30")).toBe("2:30 PM");
  });

  it("formats midnight as 12:00 AM", () => {
    expect(formatTime12h("00:00")).toBe("12:00 AM");
  });

  it("formats noon as 12:00 PM", () => {
    expect(formatTime12h("12:00")).toBe("12:00 PM");
  });

  it("formats 12:30 PM", () => {
    expect(formatTime12h("12:30")).toBe("12:30 PM");
  });

  it("formats 1:00 PM", () => {
    expect(formatTime12h("13:00")).toBe("1:00 PM");
  });

  it("formats 11:59 PM", () => {
    expect(formatTime12h("23:59")).toBe("11:59 PM");
  });

  it("returns empty string for null", () => {
    expect(formatTime12h(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatTime12h(undefined)).toBe("");
  });
});

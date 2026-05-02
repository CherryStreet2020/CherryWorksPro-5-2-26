// @vitest-environment jsdom
/**
 * Task #217: Each row in the failure drill-down has a copy button that puts
 * the masked recipient + transport + error code + timestamp on the
 * clipboard, and a toast confirms the copy.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import {
  FailureDrilldown,
  formatFailureSampleForCopy,
  buildFailureSamplesCsv,
  buildFailureSamplesCsvFilename,
} from "@/components/email-transport-health-panel";

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

afterEach(() => {
  cleanup();
  toastMock.mockReset();
});

const sampleTs = Date.UTC(2026, 3, 22, 12, 34, 56);
const sample = {
  ts: sampleTs,
  orgId: "org_123",
  transport: "graph",
  errorCode: "SEND_FAILED_500",
  recipient: "a***@e***.com (#abcd)",
};

describe("FailureDrilldown copy button (task #217)", () => {
  it("formats masked recipient + transport + error + when for the clipboard", () => {
    const text = formatFailureSampleForCopy(sample);
    expect(text).toContain("a***@e***.com (#abcd)");
    expect(text).toContain("Microsoft 365 (Graph)");
    expect(text).toContain("SEND_FAILED_500");
    expect(text).toContain(new Date(sampleTs).toISOString());
  });

  it("writes the formatted text to the clipboard and shows a confirmation toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <FailureDrilldown
        recent={[sample]}
        transportFilter={null}
        onClear={() => {}}
      />,
    );

    const button = screen.getByTestId("button-failure-sample-copy-0");
    fireEvent.click(button);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(writeText).toHaveBeenCalledWith(formatFailureSampleForCopy(sample));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledTimes(1);
    });
    const firstCall = toastMock.mock.calls[0][0];
    expect(firstCall.title).toMatch(/copied/i);
  });

  it("copies every visible row (respecting the transport filter) when 'Copy all' is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const samples = [
      sample,
      {
        ts: sampleTs - 1000,
        orgId: "org_456",
        transport: "smtp",
        errorCode: "CONN_REFUSED",
        recipient: "b***@e***.com (#efgh)",
      },
      {
        ts: sampleTs - 2000,
        orgId: "org_789",
        transport: "graph",
        errorCode: "AUTH_FAILED",
        recipient: "c***@e***.com (#ijkl)",
      },
    ];

    const { rerender } = render(
      <FailureDrilldown
        recent={samples}
        transportFilter={null}
        onClear={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("button-failure-drilldown-copy-all"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    const allText = writeText.mock.calls[0][0] as string;
    expect(allText.split("\n")).toHaveLength(3);
    expect(allText).toContain(formatFailureSampleForCopy(samples[0]));
    expect(allText).toContain(formatFailureSampleForCopy(samples[1]));
    expect(allText).toContain(formatFailureSampleForCopy(samples[2]));
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0].title).toMatch(/copied 3/i);

    writeText.mockClear();
    toastMock.mockReset();

    rerender(
      <FailureDrilldown
        recent={samples}
        transportFilter="graph"
        onClear={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("button-failure-drilldown-copy-all"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    const filteredText = writeText.mock.calls[0][0] as string;
    expect(filteredText.split("\n")).toHaveLength(2);
    expect(filteredText).toContain(formatFailureSampleForCopy(samples[0]));
    expect(filteredText).toContain(formatFailureSampleForCopy(samples[2]));
    expect(filteredText).not.toContain("CONN_REFUSED");
    expect(toastMock.mock.calls[0][0].title).toMatch(/copied 2/i);
  });

  it("downloads only the visible failure samples (respecting the transport filter) as a CSV", async () => {
    const samples = [
      sample,
      {
        ts: sampleTs - 1000,
        orgId: "org_456",
        transport: "smtp",
        errorCode: "CONN_REFUSED",
        recipient: "b***@e***.com (#efgh)",
      },
      {
        ts: sampleTs - 2000,
        orgId: "org_789",
        transport: "graph",
        errorCode: "AUTH_FAILED",
        recipient: "c***@e***.com (#ijkl)",
      },
    ];

    const createObjectURL = vi.fn().mockReturnValue("blob:mock");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });

    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    const { rerender } = render(
      <FailureDrilldown
        recent={samples}
        transportFilter={null}
        onClear={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("button-failure-drilldown-download-csv"));

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    });
    const allBlob = createObjectURL.mock.calls[0][0] as Blob;
    expect(allBlob).toBeInstanceOf(Blob);
    expect(allBlob.type).toContain("text/csv");
    const allText = await allBlob.text();
    const allLines = allText.split("\n");
    expect(allLines[0]).toBe("recipient,transport,error_code,timestamp");
    expect(allLines).toHaveLength(4);
    expect(allText).toContain("a***@e***.com (#abcd)");
    expect(allText).toContain("Microsoft 365 (Graph)");
    expect(allText).toContain("SEND_FAILED_500");
    expect(allText).toContain("CONN_REFUSED");
    expect(allText).toContain("AUTH_FAILED");
    expect(allText).toContain(new Date(sampleTs).toISOString());
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0].title).toMatch(/downloaded 3/i);

    createObjectURL.mockClear();
    toastMock.mockReset();

    rerender(
      <FailureDrilldown
        recent={samples}
        transportFilter="graph"
        onClear={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("button-failure-drilldown-download-csv"));

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    });
    const filteredBlob = createObjectURL.mock.calls[0][0] as Blob;
    const filteredText = await filteredBlob.text();
    const filteredLines = filteredText.split("\n");
    expect(filteredLines).toHaveLength(3);
    expect(filteredText).toContain("SEND_FAILED_500");
    expect(filteredText).toContain("AUTH_FAILED");
    expect(filteredText).not.toContain("CONN_REFUSED");
    expect(toastMock.mock.calls[0][0].title).toMatch(/downloaded 2/i);

    clickSpy.mockRestore();
  });

  it("includes a CSV header and ISO timestamps and escapes embedded quotes/commas", () => {
    const csv = buildFailureSamplesCsv([
      sample,
      {
        ts: sampleTs - 1000,
        orgId: "org_456",
        transport: "smtp",
        errorCode: 'WEIRD,"CODE"',
        recipient: "b***@e***.com (#efgh)",
      },
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("recipient,transport,error_code,timestamp");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("Microsoft 365 (Graph)");
    expect(lines[1]).toContain(new Date(sampleTs).toISOString());
    expect(lines[2]).toContain('"WEIRD,""CODE"""');
  });

  it("includes a timestamp in the CSV filename so multiple downloads do not collide", () => {
    const a = buildFailureSamplesCsvFilename(new Date(Date.UTC(2026, 3, 22, 12, 0, 0)));
    const b = buildFailureSamplesCsvFilename(new Date(Date.UTC(2026, 3, 22, 12, 0, 1)));
    expect(a).toMatch(/^email-failure-samples-.+\.csv$/);
    expect(a).not.toBe(b);
  });

  it("falls back to a destructive toast when the clipboard API is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });

    render(
      <FailureDrilldown
        recent={[sample]}
        transportFilter={null}
        onClear={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("button-failure-sample-copy-0"));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledTimes(1);
    });
    const firstCall = toastMock.mock.calls[0][0];
    expect(firstCall.variant).toBe("destructive");
    expect(firstCall.title).toMatch(/could not copy/i);
  });
});

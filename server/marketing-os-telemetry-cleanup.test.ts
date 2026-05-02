import { describe, it, expect, afterEach } from "vitest";
import { resolveMarketingOsTelemetryRetentionDays } from "./routes/marketing-os-telemetry-routes";
import { MARKETING_OS_TELEMETRY_RETENTION_DAYS_DEFAULT } from "@shared/schema";

const ENV_KEY = "MARKETING_OS_TELEMETRY_RETENTION_DAYS";

describe("resolveMarketingOsTelemetryRetentionDays", () => {
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("returns default when env var is unset", () => {
    delete process.env[ENV_KEY];
    expect(resolveMarketingOsTelemetryRetentionDays()).toBe(
      MARKETING_OS_TELEMETRY_RETENTION_DAYS_DEFAULT,
    );
  });

  it("returns default when env var is empty string", () => {
    process.env[ENV_KEY] = "";
    expect(resolveMarketingOsTelemetryRetentionDays()).toBe(
      MARKETING_OS_TELEMETRY_RETENTION_DAYS_DEFAULT,
    );
  });

  it("returns default for non-numeric values", () => {
    process.env[ENV_KEY] = "forever";
    expect(resolveMarketingOsTelemetryRetentionDays()).toBe(
      MARKETING_OS_TELEMETRY_RETENTION_DAYS_DEFAULT,
    );
  });

  it("returns default for negative values", () => {
    process.env[ENV_KEY] = "-7";
    expect(resolveMarketingOsTelemetryRetentionDays()).toBe(
      MARKETING_OS_TELEMETRY_RETENTION_DAYS_DEFAULT,
    );
  });

  it("returns default for zero", () => {
    process.env[ENV_KEY] = "0";
    expect(resolveMarketingOsTelemetryRetentionDays()).toBe(
      MARKETING_OS_TELEMETRY_RETENTION_DAYS_DEFAULT,
    );
  });

  it("returns default for fractional values that floor below 1", () => {
    process.env[ENV_KEY] = "0.5";
    expect(resolveMarketingOsTelemetryRetentionDays()).toBe(
      MARKETING_OS_TELEMETRY_RETENTION_DAYS_DEFAULT,
    );
  });

  it("floors fractional values >= 1", () => {
    process.env[ENV_KEY] = "1.9";
    expect(resolveMarketingOsTelemetryRetentionDays()).toBe(1);
  });

  it("accepts valid integer overrides", () => {
    process.env[ENV_KEY] = "30";
    expect(resolveMarketingOsTelemetryRetentionDays()).toBe(30);
  });
});

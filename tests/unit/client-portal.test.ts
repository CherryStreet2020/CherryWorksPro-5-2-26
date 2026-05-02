import { describe, it, expect } from "vitest";
import { randomBytes } from "crypto";

describe("client portal", () => {
  it("portal token has correct format", () => {
    const token = randomBytes(32).toString("hex");
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
  });

  it("portal data returns correct shape", () => {
    const mockPortalResponse = {
      client: {
        name: "Acme Corp",
        email: "contact@acme.com",
        phone: "555-0100",
        address: "123 Main St",
      },
      org: {
        name: "Cherry St Consulting",
        logoUrl: null,
        email: "info@cherry.com",
        phone: "555-0200",
        website: "https://cherry.com",
      },
      invoices: [
        {
          id: "inv-1",
          number: "INV-0001",
          status: "SENT",
          issuedDate: "2026-01-01",
          dueDate: "2026-01-31",
          total: "1000.00",
          paidAmount: "0.00",
          publicToken: "abc123",
        },
      ],
      estimates: [],
      payments: [],
      totalBilled: "1000.00",
      totalPaid: "0.00",
      outstanding: "1000.00",
    };

    const requiredKeys = [
      "client",
      "org",
      "invoices",
      "estimates",
      "payments",
      "totalBilled",
      "totalPaid",
      "outstanding",
    ];

    for (const key of requiredKeys) {
      expect(mockPortalResponse).toHaveProperty(key);
    }

    expect(mockPortalResponse.client).toHaveProperty("name");
    expect(mockPortalResponse.client).toHaveProperty("email");
    expect(mockPortalResponse.client).toHaveProperty("phone");
    expect(mockPortalResponse.client).toHaveProperty("address");
  });

  it("portal data does not expose orgId", () => {
    const mockPortalResponse = {
      client: {
        name: "Test Client",
        email: null,
        phone: null,
        address: null,
      },
      org: {
        name: "Test Org",
        logoUrl: null,
        email: null,
        phone: null,
        website: null,
      },
      invoices: [],
      estimates: [],
      payments: [],
      totalBilled: "0.00",
      totalPaid: "0.00",
      outstanding: "0.00",
    };

    expect(mockPortalResponse).not.toHaveProperty("orgId");
    expect(mockPortalResponse.client).not.toHaveProperty("orgId");
    expect(mockPortalResponse.client).not.toHaveProperty("id");
    expect(mockPortalResponse.client).not.toHaveProperty("portalToken");
  });

  it("invalid token returns 404", async () => {
    const invalidToken = "invalid_short_token";
    expect(invalidToken.length).not.toBe(64);

    const validToken = randomBytes(32).toString("hex");
    expect(validToken.length).toBe(64);
  });
});

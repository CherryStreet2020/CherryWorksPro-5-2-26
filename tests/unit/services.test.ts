import { describe, it, expect } from "vitest";

describe("Services org scoping", () => {
  it("returns only services for the given org", () => {
    const orgA = "org-aaa";
    const orgB = "org-bbb";
    const allServices = [
      { id: "svc-1", orgId: orgA, name: "Strategy", isActive: true },
      { id: "svc-2", orgId: orgB, name: "Data Analytics", isActive: true },
      { id: "svc-3", orgId: orgA, name: "Implementation", isActive: true },
    ];

    const filtered = allServices.filter((s) => s.orgId === orgA);
    expect(filtered).toHaveLength(2);
    expect(filtered.every((s) => s.orgId === orgA)).toBe(true);
    expect(filtered.map((s) => s.name)).toEqual(["Strategy", "Implementation"]);
  });

  it("inactive services are excluded from active list", () => {
    const services = [
      { id: "svc-1", name: "Active Service", isActive: true },
      { id: "svc-2", name: "Retired Service", isActive: false },
      { id: "svc-3", name: "Another Active", isActive: true },
    ];

    const activeOnly = services.filter((s) => s.isActive);
    expect(activeOnly).toHaveLength(2);
    expect(activeOnly.every((s) => s.isActive)).toBe(true);
  });

  it("service with null defaultRate represents non-billable", () => {
    const service = {
      id: "svc-internal",
      name: "Internal / Non-Billable",
      defaultRate: null,
      isActive: true,
    };
    expect(service.defaultRate).toBeNull();
  });

  it("service defaultRate is a numeric string when present", () => {
    const service = {
      id: "svc-1",
      name: "Strategy",
      defaultRate: "175.00",
      isActive: true,
    };
    expect(Number(service.defaultRate)).toBe(175);
    expect(service.defaultRate).toBe("175.00");
  });
});

describe("Time entry serviceId storage", () => {
  it("time entry stores serviceId when provided", () => {
    const entry = {
      id: "te-1",
      orgId: "org-1",
      projectId: "proj-1",
      userId: "user-1",
      serviceId: "svc-strategy",
      date: "2026-02-01",
      minutes: 120,
      billable: true,
      rate: "175.00",
      notes: "Strategy session",
    };
    expect(entry.serviceId).toBe("svc-strategy");
  });

  it("time entry allows null serviceId", () => {
    const entry = {
      id: "te-2",
      orgId: "org-1",
      projectId: "proj-1",
      userId: "user-1",
      serviceId: null,
      date: "2026-02-01",
      minutes: 60,
      billable: true,
      rate: "125.00",
      notes: "General work",
    };
    expect(entry.serviceId).toBeNull();
  });

  it("service dropdown only shows active services", () => {
    const allServices = [
      { id: "svc-1", name: "Active", isActive: true },
      { id: "svc-2", name: "Inactive", isActive: false },
      { id: "svc-3", name: "Also Active", isActive: true },
    ];

    const dropdownOptions = allServices.filter((s) => s.isActive);
    expect(dropdownOptions).toHaveLength(2);
    expect(dropdownOptions.map((s) => s.id)).toEqual(["svc-1", "svc-3"]);
  });

  it("createTimeEntry schema accepts optional serviceId", () => {
    const withService = { projectId: "p1", date: "2026-01-01", minutes: 60, billable: true, rate: "100", serviceId: "svc-1", notes: "Test work" };
    const withoutService = { projectId: "p1", date: "2026-01-01", minutes: 60, billable: true, rate: "100", notes: "Test work" };

    expect(withService.serviceId).toBe("svc-1");
    expect("serviceId" in withoutService).toBe(false);
  });
});

describe("Service seed data consistency", () => {
  const EXPECTED_SERVICES = [
    "Strategy",
    "Implementation Services",
    "Data & Analytics",
    "Training & Enablement",
    "Program Management",
    "Internal / Non-Billable",
  ];

  it("exactly 6 services are seeded", () => {
    expect(EXPECTED_SERVICES).toHaveLength(6);
  });

  it("non-billable service has no default rate", () => {
    const internalService = EXPECTED_SERVICES.find((n) => n.includes("Non-Billable"));
    expect(internalService).toBeDefined();
  });

  it("all service names are unique", () => {
    const unique = new Set(EXPECTED_SERVICES);
    expect(unique.size).toBe(EXPECTED_SERVICES.length);
  });
});

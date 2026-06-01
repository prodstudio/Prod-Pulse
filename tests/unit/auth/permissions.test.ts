import { describe, expect, it } from "vitest";

import {
  canManageAlerts,
  canManageHeartbeats,
  canManageIncidents,
  canManageStatusPages,
  canRunMonitors,
  canManageOperationalConfig,
  canReadOrganization,
  hasRoleAtLeast,
} from "@/lib/server/auth/permissions";

describe("organization permissions", () => {
  it("viewer cannot create or manage apps", () => {
    expect(canManageOperationalConfig("viewer")).toBe(false);
    expect(canManageAlerts("viewer")).toBe(false);
  });

  it("admin can create and manage apps", () => {
    expect(canManageOperationalConfig("admin")).toBe(true);
    expect(canManageAlerts("admin")).toBe(true);
  });

  it("responder cannot manage alert channels or rules", () => {
    expect(canManageAlerts("responder")).toBe(false);
    expect(canManageAlerts("owner")).toBe(true);
  });

  it("viewer and responder cannot manage heartbeats while admin and owner can", () => {
    expect(canManageHeartbeats("viewer")).toBe(false);
    expect(canManageHeartbeats("responder")).toBe(false);
    expect(canManageHeartbeats("admin")).toBe(true);
    expect(canManageHeartbeats("owner")).toBe(true);
  });

  it("viewer and responder cannot manage status pages while admin and owner can", () => {
    expect(canManageStatusPages("viewer")).toBe(false);
    expect(canManageStatusPages("responder")).toBe(false);
    expect(canManageStatusPages("admin")).toBe(true);
    expect(canManageStatusPages("owner")).toBe(true);
  });

  it("responder, admin, and owner can run monitors", () => {
    expect(canRunMonitors("viewer")).toBe(false);
    expect(canRunMonitors("responder")).toBe(true);
    expect(canRunMonitors("admin")).toBe(true);
    expect(canRunMonitors("owner")).toBe(true);
  });

  it("viewer cannot mutate incidents while responder, admin, and owner can", () => {
    expect(canManageIncidents("viewer")).toBe(false);
    expect(canManageIncidents("responder")).toBe(true);
    expect(canManageIncidents("admin")).toBe(true);
    expect(canManageIncidents("owner")).toBe(true);
  });

  it("role ladder remains ordered", () => {
    expect(hasRoleAtLeast("owner", "admin")).toBe(true);
    expect(hasRoleAtLeast("responder", "admin")).toBe(false);
    expect(canReadOrganization("viewer")).toBe(true);
  });
});

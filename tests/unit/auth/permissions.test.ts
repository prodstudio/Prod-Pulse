import { describe, expect, it } from "vitest";

import {
  canRunMonitors,
  canManageOperationalConfig,
  canReadOrganization,
  hasRoleAtLeast,
} from "@/lib/server/auth/permissions";

describe("organization permissions", () => {
  it("viewer cannot create or manage apps", () => {
    expect(canManageOperationalConfig("viewer")).toBe(false);
  });

  it("admin can create and manage apps", () => {
    expect(canManageOperationalConfig("admin")).toBe(true);
  });

  it("responder, admin, and owner can run monitors", () => {
    expect(canRunMonitors("viewer")).toBe(false);
    expect(canRunMonitors("responder")).toBe(true);
    expect(canRunMonitors("admin")).toBe(true);
    expect(canRunMonitors("owner")).toBe(true);
  });

  it("role ladder remains ordered", () => {
    expect(hasRoleAtLeast("owner", "admin")).toBe(true);
    expect(hasRoleAtLeast("responder", "admin")).toBe(false);
    expect(canReadOrganization("viewer")).toBe(true);
  });
});

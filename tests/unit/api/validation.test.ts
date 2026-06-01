import { describe, expect, it } from "vitest";

import { parseSchema } from "@/lib/server/api/validation";
import { ApiError } from "@/lib/server/api/errors";
import { createAppSchema } from "@/lib/server/apps/app-service";
import { createMonitorSchema } from "@/lib/server/monitors/monitor-service";

describe("request validation", () => {
  it("rejects invalid app payloads", () => {
    expect(() =>
      parseSchema(createAppSchema, {
        name: "",
        slug: "Bad Slug",
      }),
    ).toThrow(ApiError);
  });

  it("rejects invalid monitor payloads", () => {
    expect(() =>
      parseSchema(createMonitorSchema, {
        appId: "0b9f7c44-6e7b-42e1-a31a-86c7efe95353",
        name: "Health",
        slug: "health-check",
        type: "http",
        intervalSeconds: 300,
        timeoutMs: 10000,
      }),
    ).toThrow(ApiError);
  });
});

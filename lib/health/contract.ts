import { z } from "zod";

export const healthStatusSchema = z.enum(["ok", "degraded", "down"]);

export type HealthStatus = z.infer<typeof healthStatusSchema>;

export const healthCheckLeafSchema = z.union([
  healthStatusSchema,
  z
    .object({
      status: healthStatusSchema,
      latencyMs: z.number().finite().nonnegative().optional(),
    })
    .strict(),
]);

export type HealthCheckLeaf = z.infer<typeof healthCheckLeafSchema>;

export interface HealthCheckGroup {
  [key: string]: HealthCheckValue;
}

export type HealthCheckValue = HealthCheckLeaf | HealthCheckGroup;

export const healthCheckValueSchema: z.ZodType<HealthCheckValue> = z.lazy(() =>
  z.union([healthCheckLeafSchema, z.record(z.string(), healthCheckValueSchema)]),
);

export const healthResponseSchema = z
  .object({
    status: healthStatusSchema,
    service: z.string().trim().min(1),
    environment: z.string().trim().min(1),
    version: z.string().trim().min(1).optional(),
    commit: z.string().trim().min(1).optional(),
    timestamp: z.string().trim().min(1),
    checks: z.record(z.string(), healthCheckValueSchema),
  })
  .strict();

export type HealthResponse = z.infer<typeof healthResponseSchema>;

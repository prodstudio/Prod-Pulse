import {
  type HealthCheckValue,
  type HealthResponse,
  type HealthStatus,
} from "@/lib/health/contract";

type CreateHealthResponseInput = {
  status: HealthStatus;
  service: string;
  environment: string;
  version?: string;
  commit?: string;
  timestamp?: string | Date;
  checks: Record<string, HealthCheckValue>;
};

export function createHealthResponse({
  status,
  service,
  environment,
  version,
  commit,
  timestamp = new Date(),
  checks,
}: CreateHealthResponseInput): HealthResponse {
  return {
    status,
    service,
    environment,
    version,
    commit,
    timestamp:
      typeof timestamp === "string" ? new Date(timestamp).toISOString() : timestamp.toISOString(),
    checks,
  };
}

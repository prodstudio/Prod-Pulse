"use client";

import { useEffect, useMemo, useState } from "react";

type AppOption = {
  id: string;
  name: string;
};

type EnvironmentOption = {
  id: string;
  appId: string;
  name: string;
};

type NewMonitorFormProps = {
  apps: AppOption[];
  environments: EnvironmentOption[];
  errorMessage?: string | null;
  initialAppId?: string | null;
  initialEnvironmentId?: string | null;
  action: (formData: FormData) => void | Promise<void>;
};

export function NewMonitorForm({
  apps,
  environments,
  errorMessage,
  initialAppId,
  initialEnvironmentId,
  action,
}: NewMonitorFormProps) {
  const resolvedInitialAppId =
    initialAppId && apps.some((app) => app.id === initialAppId) ? initialAppId : (apps[0]?.id ?? "");
  const initialEnvironmentForApp =
    initialEnvironmentId &&
    environments.some(
      (environment) =>
        environment.id === initialEnvironmentId && environment.appId === resolvedInitialAppId,
    )
      ? initialEnvironmentId
      : "";
  const [selectedAppId, setSelectedAppId] = useState(resolvedInitialAppId);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState(initialEnvironmentForApp);

  const appEnvironments = useMemo(
    () => environments.filter((environment) => environment.appId === selectedAppId),
    [environments, selectedAppId],
  );

  useEffect(() => {
    if (appEnvironments.some((environment) => environment.id === selectedEnvironmentId)) {
      return;
    }

    setSelectedEnvironmentId("");
  }, [appEnvironments, selectedEnvironmentId]);

  return (
    <form action={action} className="space-y-6 rounded-lg border border-border bg-card p-6">
      {errorMessage ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="font-medium">Name</span>
          <input
            name="name"
            required
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="font-medium">Slug</span>
          <input
            name="slug"
            required
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="font-medium">App</span>
          <select
            name="appId"
            required
            value={selectedAppId}
            onChange={(event) => setSelectedAppId(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          >
            {apps.map((app) => (
              <option key={app.id} value={app.id}>
                {app.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="font-medium">Environment</span>
          <select
            name="environmentId"
            value={selectedEnvironmentId}
            onChange={(event) => setSelectedEnvironmentId(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          >
            <option value="">No environment</option>
            {appEnvironments.map((environment) => (
              <option key={environment.id} value={environment.id}>
                {environment.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="font-medium">Monitor type</span>
          <select
            name="type"
            defaultValue="http"
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          >
            <option value="http">HTTP uptime</option>
            <option value="api_health">API health endpoint</option>
            <option value="json_assertion">JSON assertion</option>
            <option value="latency_threshold">Latency threshold</option>
            <option value="ssl_expiry">SSL expiry</option>
            <option value="heartbeat">Heartbeat freshness</option>
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="font-medium">Request method</span>
          <select
            name="requestMethod"
            defaultValue="GET"
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          >
            {["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm md:col-span-2">
          <span className="font-medium">Target URL</span>
          <input
            name="targetUrl"
            placeholder="https://app.example.com/api/health"
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="space-y-2 text-sm md:col-span-2">
          <span className="font-medium">Description</span>
          <textarea
            name="description"
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="font-medium">Interval seconds</span>
          <input
            name="intervalSeconds"
            type="number"
            defaultValue={300}
            min={30}
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="font-medium">Timeout ms</span>
          <input
            name="timeoutMs"
            type="number"
            defaultValue={10000}
            min={1000}
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="font-medium">Latency threshold ms</span>
          <input
            name="latencyThresholdMs"
            type="number"
            min={1}
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="font-medium">Status</span>
          <select
            name="status"
            defaultValue="unknown"
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          >
            {["unknown", "operational", "degraded", "down", "paused", "maintenance"].map(
              (status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="font-medium">Consecutive failure threshold</span>
          <input
            name="consecutiveFailureThreshold"
            type="number"
            defaultValue={3}
            min={1}
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="font-medium">Consecutive recovery threshold</span>
          <input
            name="consecutiveRecoveryThreshold"
            type="number"
            defaultValue={2}
            min={1}
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
      </div>

      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          name="isEnabled"
          defaultChecked
          className="size-4 rounded border border-input"
        />
        <span>Enable monitor immediately after creation</span>
      </label>

      <button
        type="submit"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Create monitor
      </button>
    </form>
  );
}

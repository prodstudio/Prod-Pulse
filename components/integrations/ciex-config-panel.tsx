"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { SafeCiexIntegrationConfig } from "@/lib/integrations/ciex-config";

type Props = {
  initialConfig: SafeCiexIntegrationConfig | null;
};

type MutationResponse = {
  data: SafeCiexIntegrationConfig;
  secret?: string;
  error?: {
    code: string;
    message: string;
  };
};

async function postAction(path: string) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
  });

  const payload = (await response.json()) as MutationResponse;

  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "The request could not be completed.");
  }

  return payload;
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function CiexConfigPanel({ initialConfig }: Props) {
  const [config, setConfig] = useState<SafeCiexIntegrationConfig | null>(initialConfig);
  const [plaintextSecret, setPlaintextSecret] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  async function runAction(action: "create" | "enable" | "disable" | "rotate") {
    setPendingAction(action);
    setError(null);
    setStatus(null);

    try {
      const path =
        action === "create"
          ? "/api/integrations/ciex"
          : `/api/integrations/ciex/${action}`;
      const payload = await postAction(path);

      setConfig(payload.data);
      setPlaintextSecret(payload.secret ?? null);
      setStatus(action);
    } catch (cause) {
      setPlaintextSecret(null);
      setError(cause instanceof Error ? cause.message : "The request could not be completed.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-lg font-semibold tracking-tight">CIEX inbound integration</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Configure the shared secret used by CIEX to send normalized ticket updates into Prod Pulse.
      </p>

      {error ? (
        <div className="mt-5 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {status ? (
        <div className="mt-5 rounded-md border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
          CIEX integration action completed: {status}.
        </div>
      ) : null}
      {plaintextSecret ? (
        <div className="mt-5 rounded-md border border-primary/30 bg-primary/10 px-4 py-3">
          <p className="text-sm font-medium text-foreground">New inbound secret</p>
          <p className="mt-2 break-all font-mono text-sm text-foreground">{plaintextSecret}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            This plaintext secret is shown only once. Store it securely before leaving this page.
          </p>
        </div>
      ) : null}

      {config ? (
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-border px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Status
            </p>
            <p className="mt-2 text-sm">{config.isEnabled ? "Enabled" : "Disabled"}</p>
          </div>
          <div className="rounded-md border border-border px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Key hint
            </p>
            <p className="mt-2 text-sm">{config.inboundKeyHint ?? "Unavailable"}</p>
          </div>
          <div className="rounded-md border border-border px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Last inbound event
            </p>
            <p className="mt-2 text-sm">{formatTimestamp(config.lastInboundAt)}</p>
          </div>
          <div className="rounded-md border border-border px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Updated
            </p>
            <p className="mt-2 text-sm">{formatTimestamp(config.updatedAt)}</p>
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
          No CIEX inbound integration is configured for this organization yet.
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        {!config ? (
          <Button
            type="button"
            onClick={() => runAction("create")}
            disabled={pendingAction !== null}
          >
            {pendingAction === "create" ? "Creating..." : "Create integration"}
          </Button>
        ) : (
          <>
            {config.isEnabled ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => runAction("disable")}
                disabled={pendingAction !== null}
              >
                {pendingAction === "disable" ? "Disabling..." : "Disable"}
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={() => runAction("enable")}
                disabled={pendingAction !== null}
              >
                {pendingAction === "enable" ? "Enabling..." : "Enable"}
              </Button>
            )}
            <Button
              type="button"
              onClick={() => runAction("rotate")}
              disabled={pendingAction !== null}
            >
              {pendingAction === "rotate" ? "Rotating..." : "Rotate inbound key"}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

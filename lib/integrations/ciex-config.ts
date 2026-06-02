export type SafeCiexIntegrationConfig = {
  id: string;
  kind: "ciex";
  name: string;
  isEnabled: boolean;
  inboundKeyHint: string | null;
  lastInboundAt: string | null;
  createdAt: string;
  updatedAt: string;
};

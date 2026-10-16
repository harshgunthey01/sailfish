import { ingestTelemetry, burnRateSeries, costByModel } from "../../services/telemetry.js";
import { verifyIngestToken } from "../../auth/admin.js";

export { ingestTelemetry, burnRateSeries, costByModel };
export function verifyIngestAuth(modelKey: string, token: string): boolean {
  return verifyIngestToken(modelKey, token);
}

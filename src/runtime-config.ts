export interface RuntimeConfig {
  channelSecret: string;
  channelAccessToken: string;
  officialAccountUserId: string;
  systemAdministratorId: string;
  databasePath: string;
  port: number;
  bodyLimitBytes: number;
  requestTimeoutMs: number;
  workerPollMs: number;
}

export class RuntimeConfigError extends Error {}

export function loadRuntimeConfig(environment: Record<string, string | undefined> = process.env): RuntimeConfig {
  const names = ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN", "LINE_OFFICIAL_ACCOUNT_USER_ID", "TRAVEL_SYSTEM_ADMINISTRATOR_ID"];
  const missing = names.filter((name) => !environment[name]?.trim());
  if (missing.length > 0) throw new RuntimeConfigError(`Missing required environment variables: ${missing.join(", ")}`);
  return {
    channelSecret: environment.LINE_CHANNEL_SECRET!, channelAccessToken: environment.LINE_CHANNEL_ACCESS_TOKEN!, officialAccountUserId: environment.LINE_OFFICIAL_ACCOUNT_USER_ID!, systemAdministratorId: environment.TRAVEL_SYSTEM_ADMINISTRATOR_ID!,
    databasePath: environment.TRAVEL_DATABASE_PATH?.trim() || "./data/travel.sqlite",
    port: integer(environment.PORT, 3000, "PORT", 0), bodyLimitBytes: positiveInteger(environment.WEBHOOK_BODY_LIMIT_BYTES, 256 * 1024, "WEBHOOK_BODY_LIMIT_BYTES"),
    requestTimeoutMs: positiveInteger(environment.WEBHOOK_REQUEST_TIMEOUT_MS, 10_000, "WEBHOOK_REQUEST_TIMEOUT_MS"), workerPollMs: positiveInteger(environment.TRAVEL_WORKER_POLL_MS, 1_000, "TRAVEL_WORKER_POLL_MS"),
  };
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  return integer(value, fallback, name, 1);
}

function integer(value: string | undefined, fallback: number, name: string, minimum: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) throw new RuntimeConfigError(`${name} must be an integer greater than or equal to ${minimum}.`);
  return parsed;
}

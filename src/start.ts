import { createRuntime } from "./runtime.ts";

const runtime = createRuntime();
const shutdown = async (signal: string) => {
  process.stderr.write(`shutdown signal=${signal}\n`);
  await runtime.stop();
  process.exit(0);
};
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });
runtime.start().then(({ host, port }) => { process.stdout.write(`webhook_runtime_started host=${host} port=${port}\n`); }).catch((error: unknown) => { process.stderr.write(`webhook_runtime_start_failed errorType=${error instanceof Error ? error.constructor.name : "UnknownError"}\n`); process.exitCode = 1; });

import { createRuntime, createExtractionAdapter } from "./runtime.ts";

const [tripId, chunkId, userId] = process.argv.slice(2);

if (!tripId?.trim() || !chunkId?.trim() || !userId?.trim()) {
  process.stderr.write("Usage: npm run retry:trip-chunk -- <trip-id> <chunk-id> <user-id>\n");
  process.exitCode = 1;
} else {
  const runtime = createRuntime();
  try {
    const chunk = await runtime.service.retryImportChunk(tripId.trim(), userId.trim(), chunkId.trim().toUpperCase(), createExtractionAdapter(runtime.config));
    process.stdout.write(`${JSON.stringify({ chunkId: chunk.id, status: chunk.status, attempts: chunk.attempts, providerCalls: chunk.providerCalls, errorCode: chunk.errorCode ?? null, errorMessage: chunk.errorMessage ?? null })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await runtime.stop();
  }
}

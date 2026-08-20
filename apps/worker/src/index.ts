import { SystemTimeProvider } from "@clinicaos/core/time";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import pino from "pino";

/**
 * Worker — processo persistente: filas BullMQ + schedulers.
 * Fundação: sobe a conexão, registra o tick de automações (ainda no-op) e
 * expõe shutdown limpo. Os consumidores reais entram por milestone.
 */
const logger = pino({ name: "worker" });
const clock = new SystemTimeProvider();

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

export const QUEUES = {
  inbound: "q:inbound",
  inboundDebounce: "q:inbound-debounce",
  ai: "q:ai",
  outbound: "q:outbound",
  cadence: "q:cadence",
  daily: "q:daily",
  analysis: "q:analysis",
} as const;

const tickQueue = new Queue("q:tick", { connection });

async function main() {
  logger.info("Worker iniciando...");

  // Tick por minuto: varre automation_runs.next_run_at <= now() (a verdade é o Postgres).
  await tickQueue.upsertJobScheduler("automations-tick", { every: 60_000 });

  const tickWorker = new Worker(
    "q:tick",
    async () => {
      const now = clock.now();
      // TODO(milestone 6): varrer automation_runs e materializar envios.
      logger.debug({ now: now.toISOString() }, "tick");
    },
    { connection },
  );

  tickWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, "job falhou");
  });

  logger.info("Worker pronto.");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Encerrando worker...");
    await tickWorker.close();
    await tickQueue.close();
    connection.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error(err, "Erro fatal no boot do worker");
  process.exit(1);
});

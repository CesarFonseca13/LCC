import { config as loadEnv } from "dotenv";
loadEnv({ path: "../../.env" });
// Worker usa o role com BYPASSRLS (varreduras cross-tenant dos schedulers)
if (process.env.DATABASE_URL_WORKER) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_WORKER;
}

import { SystemTimeProvider } from "@clinicaos/core/time";
import { evolutionFromEnv } from "@clinicaos/whatsapp";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import pino from "pino";
import { expireApprovals, processAutomationTick } from "./automations";
import { processPdfGeneration } from "./documents";
import { processEvents, processOutbound, reconcileStuckSending } from "./whatsapp";

/**
 * Worker — processo persistente: schedulers + consumidores.
 * Regra de ouro: os jobs são INTENÇÕES; a verdade é o Postgres. Todo consumidor
 * revalida o estado no banco; Redis pode ser perdido sem perda de dados.
 */
const logger = pino({ name: "worker" });
const clock = new SystemTimeProvider();

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6380";
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

// BullMQ não aceita ":" em nomes de fila — padrão do projeto: prefixo "q-"
const schedulerQueue = new Queue("q-scheduler", { connection });

async function main() {
  logger.info("Worker iniciando...");
  const evolution = evolutionFromEnv();

  // Schedulers repetíveis (BullMQ é só o motor de disparo)
  await schedulerQueue.upsertJobScheduler("events-sweep", { every: 3_000 });
  await schedulerQueue.upsertJobScheduler("outbound-sweep", { every: 3_000 });
  await schedulerQueue.upsertJobScheduler("sending-reconcile", { every: 60_000 });
  await schedulerQueue.upsertJobScheduler("automations-tick", { every: 15_000 });
  await schedulerQueue.upsertJobScheduler("approvals-expire", { every: 60_000 });
  await schedulerQueue.upsertJobScheduler("pdf-sweep", { every: 10_000 });

  const worker = new Worker(
    "q-scheduler",
    async (job) => {
      switch (job.name) {
        case "events-sweep":
          await processEvents(logger);
          break;
        case "outbound-sweep":
          await processOutbound(evolution, logger);
          break;
        case "sending-reconcile":
          await reconcileStuckSending(logger);
          break;
        case "automations-tick":
          await processAutomationTick(logger);
          break;
        case "approvals-expire":
          await expireApprovals(logger);
          break;
        case "pdf-sweep":
          await processPdfGeneration(logger);
          break;
      }
    },
    { connection, concurrency: 2 },
  );

  worker.on("failed", (job, err) => {
    logger.error({ job: job?.name, err: err.message }, "job falhou");
  });

  logger.info("Worker pronto (sweeps: eventos 3s, envio 3s, reconciliação 60s).");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Encerrando worker...");
    await worker.close();
    await schedulerQueue.close();
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

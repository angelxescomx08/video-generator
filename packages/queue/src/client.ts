import PgBoss from "pg-boss";
import { QUEUES } from "./queues";

let bossInstance: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (bossInstance) return bossInstance;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const boss = new PgBoss({
    connectionString,
    schema: process.env.PGBOSS_SCHEMA ?? "pgboss",
    retryLimit: 3,
    retryBackoff: true,
  });

  boss.on("error", (error) => console.error("pg-boss error:", error));

  await boss.start();

  // pg-boss requires queues to exist before send()/work()/schedule() will accept them.
  for (const queueName of Object.values(QUEUES)) {
    await boss.createQueue(queueName);
  }

  bossInstance = boss;
  return boss;
}

export async function stopBoss(): Promise<void> {
  if (bossInstance) {
    await bossInstance.stop();
    bossInstance = null;
  }
}

import PgBoss from "pg-boss";
import { QUEUES } from "./queues";

let bossInstance: PgBoss | null = null;

/**
 * Politicas por cola, para las colas donde el reintento automatico global (retryLimit: 3) es
 * peligroso en vez de util.
 *
 * PUBLISH_VIDEO va con `retryLimit: 0` porque publicar NO es idempotente: sube un archivo a una
 * plataforma externa. Un caso real lo demostro — la subida a YouTube llegaba completa pero la conexion
 * moria antes de devolver la respuesta (`fetch failed`), el handler lo tomaba como fallo, pg-boss
 * reintentaba, y cada reintento subia el video OTRA VEZ. Un solo job dejo dos videos identicos en el
 * canal y ninguna fila en `published_videos`, porque el paso que guardaba la fila nunca llegaba a
 * correr.
 *
 * Con 0 reintentos, un fallo de red deja como maximo un video huerfano en vez de cuatro, y el
 * reintento pasa a ser una decision explicita de la persona (que puede mirar el canal antes). El
 * handler ademas detecta y adopta esa subida huerfana en vez de duplicarla.
 */
const QUEUE_RETRY_LIMITS: Partial<Record<string, number>> = {
  [QUEUES.PUBLISH_VIDEO]: 0,
};

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
    const retryLimit = QUEUE_RETRY_LIMITS[queueName];
    const options = retryLimit === undefined ? undefined : { name: queueName, retryLimit };
    await boss.createQueue(queueName, options);
    // createQueue no toca una cola que ya existe, asi que la politica tambien se aplica con
    // updateQueue: sin esto, una instalacion que ya venia corriendo se quedaria con el retryLimit
    // global de 3 en publish-video — justamente el que duplica videos.
    if (options) await boss.updateQueue(queueName, options);
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

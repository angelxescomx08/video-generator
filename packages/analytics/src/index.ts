/**
 * Dominio de analiticas: agregacion de rendimiento y de costo sobre la base de datos.
 *
 * Existe como paquete propio porque tiene dos consumidores que no se conocen: `apps/worker`, que
 * usa el aprendizaje para escribir el prompt del siguiente guion, y `apps/web`, que dibuja esas
 * mismas cifras. Antes vivia dentro del worker, asi que la UI no podia leerlo sin duplicarlo.
 *
 * Contrato del paquete: **toda funcion que consulta es una sola ida a la base y agrega en Postgres**.
 * Es lo que mantiene el tiempo de respuesta plano cuando el canal pasa de diez videos a mil.
 */
export * from "./time-range";
export * from "./video-attributes";
export * from "./learnings";
export * from "./channel-queries";
export * from "./cost-queries";
export * from "./cost-model";
export * from "./video-queries";

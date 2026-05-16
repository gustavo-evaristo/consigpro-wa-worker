/**
 * Flag mestra do wa-worker. Quando false (default), o worker:
 * - NAO tenta abrir sockets Baileys via reconcile periodico.
 * - NAO processa jobs BullMQ recebidos do bot-api (devolve warning).
 * - Ainda mantem conexao com Redis/Postgres e responde /health.
 *
 * Existe para que o wa-worker possa estar deployed e disponivel
 * (scale > 0) sem competir com o bot-api pelos locks Redis. Quando
 * for hora do cutover, set para true junto com WA_WORKER_ENABLED=true
 * no bot-api.
 */
export function isWaWorkerActive(): boolean {
  const v = (process.env.WA_WORKER_ACTIVE ?? '').toLowerCase();
  return v === 'true' || v === '1';
}

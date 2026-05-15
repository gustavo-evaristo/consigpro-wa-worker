// Filas BullMQ que o bot-api enfileira e o wa-worker consome.
// Cada fila tem 1 tipo de job. O nome do job dentro da fila eh ignorado;
// o consumer trata pelo nome da fila.

export const WA_SESSION_QUEUE = 'wa.session';
export const WA_MESSAGE_QUEUE = 'wa.message';
export const WA_READ_QUEUE = 'wa.read';

export interface StartSessionJobData {
  userId: string;
  targetPhoneNumber?: string | null;
}

export interface SendMessageJobData {
  userId: string;
  leadPhoneNumber: string;
  content: string;
  // ID interno do bot-api (pending_outbound_message ou message_history)
  // pra que ele consiga correlacionar o resultado.
  correlationId: string;
}

export interface SendMessageJobResult {
  whatsappMessageId: string | null;
  correlationId: string;
}

export interface MarkAsReadJobData {
  userId: string;
  keys: Array<{ id: string; remoteJid: string; fromMe?: boolean }>;
}

// Canais Redis Pub/Sub que o wa-worker publica e o consigpro-api consome.
// Cada evento eh JSON.stringify do payload correspondente.

export const WA_EVENT_QR = 'wa:event:qr';
export const WA_EVENT_STATUS = 'wa:event:status';
export const WA_EVENT_MESSAGE_RECEIVED = 'wa:event:message.received';
export const WA_EVENT_MESSAGE_STATUS = 'wa:event:message.status';
// Mensagem enviada pelo proprio numero conectado, mas a partir do celular
// (WhatsApp Business app) — chega via messages.upsert com key.fromMe=true.
// Sincronizada para o app web sem rodar o fluxo.
export const WA_EVENT_MESSAGE_SENT_FROM_PHONE = 'wa:event:message.sent_from_phone';

export interface WaQrEventPayload {
  userId: string;
  qrDataUrl: string;
}

export interface WaStatusEventPayload {
  userId: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'PENDING';
  phone: string | null;
}

export interface WaMessageReceivedPayload {
  userId: string;
  whatsappMessageId: string | null;
  botPhoneNumber: string;
  leadPhoneNumber: string;
  leadName: string | null;
  text: string;
  mediaUrl: string | null;
  mediaType: 'image' | null;
  receivedAt: string;
}

export interface WaMessageStatusPayload {
  userId: string;
  whatsappMessageId: string;
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
}

export interface WaMessageSentFromPhonePayload {
  userId: string;
  whatsappMessageId: string | null;
  botPhoneNumber: string;
  leadPhoneNumber: string;
  text: string;
  mediaUrl: string | null;
  mediaType: 'image' | null;
  sentAt: string;
}

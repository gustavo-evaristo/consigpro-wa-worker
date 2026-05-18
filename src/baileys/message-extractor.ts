/**
 * Desembrulha wrappers comuns do WhatsApp (ephemeral, viewOnce, edited, etc).
 * Sem unwrap, o conteudo real (texto, imagem, etc) fica invisivel.
 */
export function unwrapMessageContent(msg: any): any {
  let current = msg;
  for (let i = 0; i < 5; i++) {
    if (!current) return null;
    const inner =
      current.ephemeralMessage?.message ??
      current.viewOnceMessage?.message ??
      current.viewOnceMessageV2?.message ??
      current.viewOnceMessageV2Extension?.message ??
      current.documentWithCaptionMessage?.message ??
      current.editedMessage?.message ??
      null;
    if (!inner) return current;
    current = inner;
  }
  return current;
}

export function extractMessageText(innerMessage: any): string | null {
  return (
    innerMessage?.conversation ||
    innerMessage?.extendedTextMessage?.text ||
    innerMessage?.imageMessage?.caption ||
    innerMessage?.videoMessage?.caption ||
    innerMessage?.documentMessage?.caption ||
    innerMessage?.buttonsResponseMessage?.selectedDisplayText ||
    innerMessage?.listResponseMessage?.title ||
    innerMessage?.templateButtonReplyMessage?.selectedDisplayText ||
    innerMessage?.templateMessage?.hydratedTemplate?.hydratedContentText ||
    innerMessage?.templateMessage?.fourRowTemplate?.content?.conversation ||
    innerMessage?.templateMessage?.fourRowTemplate?.content?.extendedTextMessage?.text ||
    innerMessage?.interactiveMessage?.body?.text ||
    innerMessage?.reactionMessage?.text ||
    null
  );
}

export function describeMessageShape(msg: any, depth = 0): string {
  if (!msg || typeof msg !== 'object' || depth > 5) return '';
  const k = Object.keys(msg)[0];
  if (!k) return '';
  const child = describeMessageShape(msg[k], depth + 1);
  return child ? `${k}.${child}` : k;
}

export function normalizeBrazilianPhone(phone: string): string {
  const digits = phone.replace('+', '');
  if (digits.startsWith('55') && digits.length === 12) {
    return '+' + digits.slice(0, 4) + '9' + digits.slice(4);
  }
  return phone;
}

export function brazilianPhoneCandidates(cleanPhone: string): string[] {
  if (!cleanPhone.startsWith('55')) return [cleanPhone];
  if (cleanPhone.length === 13) {
    const without9 = cleanPhone.slice(0, 4) + cleanPhone.slice(5);
    return [cleanPhone, without9];
  }
  if (cleanPhone.length === 12) {
    const with9 = cleanPhone.slice(0, 4) + '9' + cleanPhone.slice(4);
    return [cleanPhone, with9];
  }
  return [cleanPhone];
}

const baileysStatusMap: Record<
  number,
  'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | null
> = {
  0: 'FAILED',
  1: 'PENDING',
  2: 'SENT',
  3: 'DELIVERED',
  4: 'READ',
  5: 'READ',
};

export function mapBaileysStatus(
  status: number,
): 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | null {
  return baileysStatusMap[status] ?? null;
}

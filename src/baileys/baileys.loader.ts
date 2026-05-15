import type * as BaileysType from '@whiskeysockets/baileys';

// Baileys v7 eh ESM-only. Usamos new Function pra preservar import() nativo
// quando o TS compila pra CommonJS (NestJS default).
const nativeImport = new Function('m', 'return import(m)') as (
  m: string,
) => Promise<typeof BaileysType>;

let cached: typeof BaileysType | null = null;

export async function loadBaileys(): Promise<typeof BaileysType> {
  if (!cached) {
    cached = await nativeImport('@whiskeysockets/baileys');
  }
  return cached;
}

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Suprime logs verbosos da libsignal/Baileys que vem via console.log direto.
 * Mesmo padrao do consigpro-api — manter ambos os apps com logs limpos.
 */
function silenceLibsignalNoise() {
  const SUPPRESS = [
    /^Closing session:/,
    /^Removing old closed session:/,
    /^Session error:/,
    /^Failed to decrypt message with any known session/,
    /^\s+at .+libsignal/,
    /^\s+at .+@whiskeysockets/,
    /^\s+at SessionCipher\./,
    /^\s+at Object\.verifyMAC/,
    /^\s+at _asyncQueueExecutor/,
    /^\s+at async _asyncQueueExecutor/,
    /^\s+at async \d+_[\d.]+/,
    /^\s+at async SessionCipher/,
  ];
  const matches = (arg: unknown) => typeof arg === 'string' && SUPPRESS.some((re) => re.test(arg));
  const origLog = console.log.bind(console);
  const origError = console.error.bind(console);
  console.log = (...args: unknown[]) => {
    if (args.length > 0 && matches(args[0])) return;
    origLog(...args);
  };
  console.error = (...args: unknown[]) => {
    if (args.length > 0 && matches(args[0])) return;
    origError(...args);
  };
}

async function bootstrap() {
  silenceLibsignalNoise();
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 8080);
  await app.listen(port, '0.0.0.0');
  console.log(`[wa-worker] listening on port ${port}`);
}

bootstrap();

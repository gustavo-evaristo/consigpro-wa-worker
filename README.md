# wa-worker

Worker isolado de WhatsApp/Baileys. Roda separado do `bot-api` para
isolar o **plano de dados** (sockets Baileys + Signal protocol) do
**plano HTTP** (API REST + Socket.IO do frontend).

## Por que existe

Antes desta separação:
- Cada `fly deploy` do `bot-api` derrubava os sockets WhatsApp (~10-15 s).
- Bug no controller de fluxo podia matar as sessões Baileys.
- API e Baileys competiam por CPU/memória da mesma máquina.

Agora:
- Deploy do `bot-api` (rotas, lógica de flow) não toca em `wa-worker`.
- `wa-worker` pode escalar/migrar independente.
- Falha em um lado não derruba o outro.

## Comunicação com bot-api

### Jobs (bot-api → wa-worker) via BullMQ
- `wa.session` — abrir/reabrir sessão WhatsApp para um userId.
- `wa.message` — enviar mensagem.
- `wa.read` — marcar mensagens como lidas.

### Eventos (wa-worker → bot-api) via Redis Pub/Sub
- `wa:event:qr` — QR code gerado, pronto pra escanear.
- `wa:event:status` — CONNECTED / DISCONNECTED / PENDING.
- `wa:event:message.received` — mensagem chegou (bot-api roda flow).
- `wa:event:message.status` — entregue / lida.

## Recursos compartilhados

- **Postgres (Supabase)**: ambos os apps leem/escrevem a mesma DB.
  Wa-worker só usa `whatsapp_sessions` (auth state). Resto é do bot-api.
- **Redis (Upstash)**: locks distribuídos, pub/sub, BullMQ.
- **Supabase Storage**: bucket `wa-media` para imagens recebidas.

## Variáveis de ambiente

```
PORT=8080                          # default
NODE_ENV=production
DATABASE_URL=postgresql://...      # mesmo do bot-api
REDIS_URL=rediss://...             # mesmo do bot-api
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJh...
SUPABASE_STORAGE_BUCKET=wa-media
WA_WORKER_ACTIVE=false             # standby; vira true no cutover
```

## Coexistência segura com bot-api (modo standby)

`WA_WORKER_ACTIVE=false` (default) deixa o wa-worker "vivo mas idle":

- ✅ Conecta no Redis, Postgres, BullMQ, responde `/health`.
- ❌ Não tenta abrir sockets Baileys (reconcile no-op).
- ❌ Rejeita jobs BullMQ.

Permite manter o wa-worker deployed (scale > 0) sem competir com o
bot-api pelos locks. O cutover acontece quando você sobe **as duas
flags juntas**:

| `WA_WORKER_ACTIVE` (wa-worker) | `WA_WORKER_ENABLED` (bot-api) | Resultado |
|---|---|---|
| `false` | `false` | bot-api faz tudo; wa-worker idle. **Estado seguro.** |
| `true` | `true` | wa-worker assume; bot-api consume eventos. **Modo desejado.** |
| Misto | Misto | INSTÁVEL. Mensagens podem ficar órfãs. **Evitar.** |

## Deploy

```bash
# 1. Criar app no Fly (uma vez)
fly apps create consigpro-wa-worker

# 2. Setar secrets
fly secrets set \
  DATABASE_URL="..." \
  REDIS_URL="..." \
  SUPABASE_URL="..." \
  SUPABASE_SERVICE_ROLE_KEY="..." \
  SUPABASE_STORAGE_BUCKET="wa-media" \
  NODE_ENV="production" \
  -a consigpro-wa-worker

# 3. Deploy
fly deploy

# 4. Ativar no bot-api (depois de validar 24h o wa-worker rodando)
fly secrets set WA_WORKER_ENABLED=true -a bot-api-test
fly deploy -a bot-api-test
```

## Rollback

```bash
# Voltar bot-api ao modo local (Baileys interno)
fly secrets set WA_WORKER_ENABLED=false -a bot-api-test
fly deploy -a bot-api-test

# Desligar wa-worker
fly scale count 0 -a consigpro-wa-worker
```

## Dev local

```bash
# Mesmas variáveis no .env, mas usando DB/Redis de dev (NÃO prod)
pnpm install
npx prisma generate
pnpm dev
```

## Health check

`GET /health` → `{ "status": "ok", "timestamp": "..." }`.
Usado pelo Fly para healthcheck HTTP.

## Logs

Padrão `[Component] mensagem`. Logs verbosos do libsignal (Bad MAC,
Closing session) são silenciados em `main.ts:silenceLibsignalNoise`.

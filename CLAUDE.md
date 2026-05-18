# CLAUDE.md

Orientações para o Claude Code (claude.ai/code) ao trabalhar neste repositório.

> Idioma: comentários, logs e mensagens em **português (pt-BR)**, seguindo a convenção do restante do código.

## Papel deste serviço

`wa-worker` é o **plano de dados WhatsApp** do produto. Roda isolado do `consigpro-api` para que travamentos/restarts do Baileys não derrubem a API HTTP.

Responsabilidades:

- Manter sessões Baileys (autenticação, reconexão, QR code) por usuário
- Consumir jobs de BullMQ (Redis) enfileirados pela API: iniciar sessão, enviar mensagem, marcar como lido
- Publicar eventos via Redis Pub/Sub para a API consumir (QR, status de conexão, mensagens recebidas, status de entrega)
- Reconciliar estado de sessão periodicamente

**Não expõe endpoints REST de negócio.** Só health-check em HTTP. Toda comunicação com o `consigpro-api` é assíncrona via Redis.

Repositórios irmãos:

- `api/` — backend que enfileira jobs e consome eventos
- `web/` — frontend (não se comunica diretamente com este serviço)

## Comandos

```bash
pnpm dev          # nest start --watch (assume REDIS_URL e DATABASE_URL setados)
pnpm build        # nest build
pnpm start:prod   # node dist/main
pnpm lint         # ESLint com auto-fix
pnpm format       # Prettier
```

Após mudar `prisma/schema.prisma` (deve ficar igual ao do `consigpro-api`):

```bash
npx prisma generate
```

Migrations são aplicadas pelo `consigpro-api` — **não rode `prisma migrate` daqui**.

## Arquitetura

### Estrutura

| Pasta          | Finalidade                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `baileys/`     | Cliente Baileys, `SessionManagerService` (sessões por userId), extractor de mensagens, auth state |
| `queue/`       | BullMQ: `queue.constants.ts` (contratos com a API) + `processors/` (um processor por fila)        |
| `events/`      | Redis Pub/Sub publisher + canais (`event-channels.ts` espelha o api)                              |
| `persistence/` | Prisma service + `whatsapp-session.repository.ts` (creds, status, telefone conectado)             |
| `reconcile/`   | `@Cron` que reconcilia estado de sessões (DB ↔ memória do worker)                                 |
| `redis/`       | Conexão ioredis + lock distribuído                                                                |
| `storage/`     | Upload de mídia recebida (mesma interface do api)                                                 |
| `health/`      | `/health` para Fly.io                                                                             |
| `config/`      | Carregamento de env vars                                                                          |
| `generated/`   | Prisma client gerado (gitignored)                                                                 |

### Fluxo

**Job de envio:**
`consigpro-api → BullMQ (wa.message) → SendMessageProcessor → SessionManager.send() → Baileys → WhatsApp`
→ resultado (com `whatsappMessageId`) volta no `SendMessageJobResult` da BullMQ.

**Evento recebido:**
`WhatsApp → Baileys (messages.upsert) → MessageExtractor → EventPublisher.publish(WA_EVENT_MESSAGE_RECEIVED) → Redis Pub/Sub → consigpro-api → Socket.io → web`

**Status de conexão / QR:**
`Baileys (connection.update) → EventPublisher → Redis Pub/Sub (wa:event:status | wa:event:qr) → consigpro-api`

### Contrato com o `consigpro-api`

Os arquivos `queue/queue.constants.ts` e `events/event-channels.ts` **devem ficar idênticos** aos correspondentes em `api/src/infra/wa-bridge/wa-bridge.constants.ts`. Ao alterar:

1. Edite os dois lados no mesmo PR.
2. Não renomeie filas (`wa.session`, `wa.message`, `wa.read`) ou canais (`wa:event:*`) sem coordenar deploy — jobs antigos podem ficar órfãos.
3. `correlationId` em `SendMessageJobData` é opaco para o worker — devolva intacto em `SendMessageJobResult`.

## Banco de dados

Postgres (Supabase) compartilhado com o `consigpro-api`. O worker lê/escreve em:

- `whatsapp_sessions` — `creds`, `keys`, `connectionStatus`, `connectedPhone`, `lastSeenAt`. Único escritor autorizado de `creds`/`keys` é este worker (a API só lê)
- `message_history` — atualiza `status` e `statusUpdatedAt` quando recebe acks do Baileys
- `pending_outbound_message` — marca como `SENT` / `FAILED` após processar
- `conversations` / `message_history` — pode criar/anexar mensagens recebidas (verifique caminho atual no consumer; alguns fluxos delegam isso à API via evento)

O schema **completo** mora aqui também porque o worker usa Prisma — mas só essas tabelas são modificadas por ele.

## Regras importantes

1. **Só este serviço fala com o WhatsApp.** Nada de `whatsapp-web.js` ou Baileys fora do `wa-worker` em produção (`WA_WORKER_ENABLED=true` na API).
2. **Pub/Sub é fire-and-forget.** Para garantia de entrega worker → api, use o resultado do job BullMQ, não Pub/Sub.
3. **Sessão é por `userId`.** O `SessionManagerService` mantém um socket Baileys por usuário; nunca compartilhe sockets nem use número de telefone como chave.
4. **Logs limpos:** `silenceLibsignalNoise()` em `main.ts` filtra ruído conhecido da libsignal (Bad MAC, Closing session, etc.). Não adicione `console.log` direto — use o logger do Nest.
5. **Reconciliação não substitui idempotência.** Processors devem tolerar reentrega de jobs (mesmo `correlationId` chegando duas vezes).
6. **Não rode `prisma migrate` daqui.** A API é dona do schema; este worker só gera client.
7. **Lock distribuído (`redis/redis-lock.service.ts`)** para qualquer operação que precise ser singleton entre múltiplas instâncias do worker (ex.: reconcile global). Sessões em si já são naturalmente particionadas por userId.

## Variáveis de ambiente

```
PORT=8080
DATABASE_URL=             # mesmo Postgres do consigpro-api
REDIS_URL=                # mesmo Redis do consigpro-api
```

## Deploy

Fly.io (`fly.toml`). Imagem Docker (`Dockerfile`). Health-check em `/health`. Múltiplas réplicas exigem que cada sessão Baileys fique numa instância só — isso é tratado por `SessionManagerService` + lock; revise antes de escalar horizontalmente.

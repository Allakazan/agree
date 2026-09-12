<p align="center">Backend do <strong>Agree</strong> — API NestJS com chat em tempo real via WebSocket.</p>

## Descrição

Serviço backend construído com [NestJS](https://nestjs.com/), combinando dois bancos de dados:

- **MongoDB** (via Mongoose) — usuários e servidores (`server`).
- **PostgreSQL** (via [Drizzle ORM](https://orm.drizzle.team/)) — conversas e mensagens do chat.

A comunicação de chat em tempo real é feita via **Socket.IO** (`@nestjs/websockets`), autenticação via **JWT**, e a documentação da API é gerada com **Swagger**.

## Requisitos

- Node.js 20+ (o repo foi validado com Node 24 via `nvm`)
- Yarn
- Docker + Docker Compose (para subir Postgres, MongoDB e Redis localmente)

## Configuração do ambiente

1. Copie o arquivo de exemplo e ajuste os valores conforme necessário:

   ```bash
   cp .env.example .env
   ```

2. Variáveis de ambiente usadas pela aplicação:

   | Variável       | Descrição                                                    | Default (docker-compose)                                     |
   | -------------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
   | `PORT`         | Porta HTTP da API                                              | `3000`                                                          |
   | `DATABASE_URL` | Connection string do PostgreSQL (usado pelo Drizzle)           | `postgresql://nestuser:nestpass@localhost:5432/nestapp`         |
   | `MONGODB_URI`  | Connection string do MongoDB (usado pelo Mongoose)             | `mongodb://root:1234@localhost:27017/agree?authSource=admin`    |
   | `JWT_SECRET`   | Segredo para assinar/validar os tokens JWT de autenticação     | *(defina um valor forte, ex.: `openssl rand -hex 32`)*          |
   | `ORIGIN`       | Origens liberadas no CORS (REST + WS), separadas por vírgula   | *(vazio = qualquer origem)*                                     |
   | `TRUST_PROXY_HOPS` | Proxies confiáveis na frente da API; define qual entrada do `X-Forwarded-For` vira `req.ip` (usado pelo rate limit) | `1` |

   > Os WebSockets (`ChatGateway` no namespace `/chat`, `VoiceGateway` no `/voice`) são anexados ao servidor HTTP do Nest, ou seja, escutam na **mesma** porta da API (`PORT`) — o que separa os gateways são os namespaces, não portas. O CORS de REST e WS sai da mesma config em `src/common/cors.ts`: a lista do `ORIGIN` ou, se ele estiver vazio, qualquer origem. Nesse caso a origem é **refletida** (`origin: true`), não `*` — com `credentials: true`, o browser recusa o curinga em request credenciada, e o cookie `agree_token` é um dos caminhos de auth do WS.
   >
   > O REST tem rate limit por IP e por rota (`@nestjs/throttler`, limites em `src/common/throttle.ts`): 120 req/min por rota, e 10/min no `POST /auth/login`. Estourar devolve `429` com `Retry-After`. O `/health` não é limitado, e os WebSockets ainda não têm limite. A contagem fica em memória, ou seja, é por instância.
   >
   > O JWT expira em **7 dias** (`auth.module.ts`, `expiresIn: '7d'` — originalmente estava em 60s, aumentado a pedido para uso diário) e não há endpoint de refresh.

3. Variáveis do módulo de voz (`src/config/voice.ts`). **Nenhuma é obrigatória** — todas têm default e o módulo sobe sem nenhuma delas:

   | Variável                  | Descrição                                                                   | Default                          |
   | ------------------------- | --------------------------------------------------------------------------- | -------------------------------- |
   | `VOICE_MESH_MAX`          | Acima disso a sala precisaria de SFU; como o SFU é Fase 2, o join é recusado | `5`                              |
   | `VIDEO_MESH_MAX`          | Idem, com publisher de vídeo. Sem efeito até a Fase 2                        | `2`                              |
   | `VOICE_MAX_AUDIO_BITRATE` | Teto por stream de áudio (Opus mono), em bps                                 | `40000`                          |
   | `VOICE_UPLINK_BUDGET`     | Uplink total assumido por cliente; no mesh o teto por peer divide isso       | `VOICE_MAX_AUDIO_BITRATE × VOICE_MESH_MAX` |
   | `TURN_URL`                | TURN estático (lista por vírgula). **Vence** o Cloudflare quando definido    | *(vazio)*                        |
   | `TURN_USER` / `TURN_PASS` | Credenciais do TURN estático                                                 | *(vazio)*                        |
   | `CF_TURN_KEY_ID`          | Cloudflare Realtime TURN — id da chave                                       | *(vazio)*                        |
   | `CF_TURN_KEY_API_TOKEN`   | Cloudflare Realtime TURN — token de API                                      | *(vazio)*                        |
   | `CF_TURN_TTL`             | Validade das credenciais mintadas, em segundos (Cloudflare limita a 24h)     | `3600`                           |
   | `STUN_URL`                | STUN de último recurso, quando não há TURN nenhum (lista por vírgula)        | `stun:stun.cloudflare.com:3478`  |

   > O `VoiceIceService` escolhe em três níveis: **TURN estático** (se `TURN_URL`), senão **Cloudflare** (se as duas chaves), senão **STUN-only**. Sem TURN o áudio funciona em dev, mas ~15–20% dos usuários reais (NAT simétrico) não conseguem conectar. Um valor `<= 0` ou não-numérico em qualquer knob numérico cai no default em vez de propagar (`src/common/env.ts`).

## Subindo a infraestrutura (Docker)

```bash
docker compose up -d
```

Isso sobe três serviços:

| Serviço    | Container      | Porta  | Observação                                   |
| ---------- | -------------- | ------ | --------------------------------------------- |
| PostgreSQL | `nest_postgres`| 5432   | database `nestapp`, user `nestuser`            |
| MongoDB    | `nest_mongo`   | 27017  | database `agree`, root user `root`             |
| Redis      | `nest_redis`   | 6379   | subido, mas não é usado por nenhum módulo hoje |

## Instalação de dependências

```bash
yarn install
```

## Migrações do banco (PostgreSQL / Drizzle)

O schema do Drizzle fica em `src/drizzle/schema.ts` e as migrações já geradas em `drizzle/`. Com o Postgres rodando e o `.env` configurado, aplique as migrações:

```bash
npx drizzle-kit migrate
```

Outros comandos úteis do Drizzle Kit:

```bash
npx drizzle-kit generate   # gera uma nova migration a partir de alterações no schema.ts
npx drizzle-kit studio     # abre o Drizzle Studio para inspecionar o banco
```

## Seed do MongoDB (opcional)

Popula o MongoDB com servidores e usuários fake (via `@faker-js/faker`), incluindo um usuário fixo `admin@example.com` / `admin123`:

```bash
yarn mongodb:seed
```

## Rodando a aplicação

```bash
# desenvolvimento
yarn start

# watch mode
yarn start:dev

# debug
yarn start:debug

# produção (requer yarn build antes)
yarn build
yarn start:prod
```

A API sobe em `http://localhost:3000` (ou na porta definida em `PORT`). A documentação Swagger fica disponível em `http://localhost:3000/api`.

## Testes

```bash
yarn test        # unitários
yarn test:e2e     # end-to-end
yarn test:cov     # cobertura
```

## Deploy (GCP Cloud Run)

Todo push na `master` dispara [`.github/workflows/deploy-cloud-run.yml`](.github/workflows/deploy-cloud-run.yml): testes, `drizzle-kit migrate` no Postgres de produção, build da imagem do [`Dockerfile`](Dockerfile), push no Artifact Registry e `gcloud run deploy`. As migrations rodam **antes** do deploy — se falharem, a revisão nova não sobe. O MongoDB não tem migrations (o Mongoose cria collections e índices sozinho). O serviço sobe com `min-instances=0`, `max-instances=1`, 1 vCPU, 512Mi, concorrência 500 e timeout de 3600s (billing por request).

> `max-instances=1` não é economia: as rooms do Socket.IO vivem na memória do processo, então uma segunda instância parte o chat e a voz ao meio. Subir esse número exige o `@socket.io/redis-adapter` antes.

O setup de GCP (Artifact Registry, Secret Manager, service accounts) e as variáveis que o workflow espera no GitHub estão em [docs/deploy-cloud-run.md](docs/deploy-cloud-run.md).

## Estrutura de módulos

- `modules/auth` — login (`POST /auth/login`) e perfil autenticado (`GET /auth/profile`), guard JWT global (rotas marcadas com `@Public()` não exigem token).
- `modules/users` — acesso a usuários (MongoDB), usado internamente pelo `auth`.
- `modules/server` — CRUD básico de "servers" (MongoDB): `POST /server`, `GET /server`.
- `modules/chat` — histórico de mensagens via REST (`GET /chat/:channelId`, resolve a conversa internamente pelo `relatedMongoChannelId`) e envio em tempo real via WebSocket (evento `chat` no namespace `/chat`, na mesma porta da API, protegido por `AuthGuard`).
- `modules/voice` — sinalização WebRTC para canais de voz (namespace `/voice`) e roster via REST (`GET /voice/:channelId/participants`). **O áudio não passa pelo servidor**: Cloud Run não trafega UDP, então a mídia vai browser↔browser em mesh P2P e o backend só carrega presença, SDP/ICE e as credenciais de TURN. Fase 1 é só áudio, até `VOICE_MESH_MAX` participantes. Design em [docs/voice-webrtc.md](docs/voice-webrtc.md); o guia de integração do front está em [docs/voice-client.md](docs/voice-client.md).

## Notas de diagnóstico deste setup

- Não havia `.env` no repositório; foi criado a partir dos valores default do `docker-compose.yml` (Postgres, Mongo) e um `JWT_SECRET` de desenvolvimento — **troque o `JWT_SECRET` antes de usar em produção**.
- As migrações do Drizzle (pasta `drizzle/`) não estavam aplicadas no Postgres; foram aplicadas com `npx drizzle-kit migrate`. Não havia script `migrate` no `package.json` — rode o comando manualmente quando o schema mudar.
- O serviço `redis` do `docker-compose.yml` sobe normalmente, mas não há nenhuma integração com Redis no código atual (pode ser infraestrutura para uso futuro).

## Mudanças feitas para o [agree-app](../agree-app) (frontend Next.js) conseguir conectar de verdade

1. **CORS do WebSocket** liberado para `http://localhost:3001`, além da origem antiga do `socket_debug.html`.
2. **`GET /chat/:conversationId` → `GET /chat/:channelId`**: a rota antiga exigia o UUID interno do Postgres, que nenhum endpoint expunha — agora ela recebe o `channelId` do Mongo (mesmo ID usado no evento WS) e resolve a conversa internamente via `ChatService.findAllByChannel`.
3. **Bug de autenticação corrigido no `ChatGateway`**: o guard global de JWT (`APP_GUARD`, registrado em `AuthModule`) não estava sendo aplicado aos handlers do gateway WS — `@User()` chegava `undefined` e qualquer mensagem enviada quebrava com `Cannot read properties of undefined (reading 'sub')`, mesmo com um token válido. Corrigido com `@UseGuards(AuthGuard)` explícito no `ChatGateway` (e `AuthGuard` registrado como provider em `ChatModule`, já que não estava disponível fora do `AuthModule`). **Isso não é uma mudança de escopo do frontend — era um bug pré-existente que impedia o chat em tempo real de funcionar de qualquer cliente real**, não só do Next.
4. O gateway agora transmite a **mensagem completa** (`id`, `senderUsername`, `createdAt`, etc.) no evento `channel:<id>:messages`, em vez de só a string do texto.

Os 49 testes (`yarn jest`) continuam passando após essas mudanças; `chat.gateway.spec.ts` precisou de `overrideGuard(AuthGuard)` para compilar o módulo de teste isolado.

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

   > O WebSocket do chat (`ChatGateway`) é anexado ao servidor HTTP do Nest, ou seja, escuta na **mesma** porta da API (`PORT`) — o que separa os gateways são os namespaces (`/chat`), não portas. O CORS de REST e WS sai da mesma config em `src/common/cors.ts`: a lista do `ORIGIN` ou, se ele estiver vazio, qualquer origem. Nesse caso a origem é **refletida** (`origin: true`), não `*` — com `credentials: true`, o browser recusa o curinga em request credenciada, e o cookie `agree_token` é um dos caminhos de auth do WS.
   >
   > O JWT expira em **7 dias** (`auth.module.ts`, `expiresIn: '7d'` — originalmente estava em 60s, aumentado a pedido para uso diário) e não há endpoint de refresh.

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

## Estrutura de módulos

- `modules/auth` — login (`POST /auth/login`) e perfil autenticado (`GET /auth/profile`), guard JWT global (rotas marcadas com `@Public()` não exigem token).
- `modules/users` — acesso a usuários (MongoDB), usado internamente pelo `auth`.
- `modules/server` — CRUD básico de "servers" (MongoDB): `POST /server`, `GET /server`.
- `modules/chat` — histórico de mensagens via REST (`GET /chat/:channelId`, resolve a conversa internamente pelo `relatedMongoChannelId`) e envio em tempo real via WebSocket (evento `chat` no namespace `/chat`, na mesma porta da API, protegido por `AuthGuard`).

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

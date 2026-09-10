# Deploy no GCP Cloud Run

O workflow [`.github/workflows/deploy-cloud-run.yml`](../.github/workflows/deploy-cloud-run.yml)
roda a cada push na `master` (e sob demanda, pelo botão _Run workflow_): testa,
aplica as migrations do Postgres, builda a imagem do [`Dockerfile`](../Dockerfile),
publica no Artifact Registry e faz `gcloud run deploy` da revisão nova.

Este documento é o setup que precisa existir **do lado do Google e do GitHub**
antes do primeiro push — o workflow assume tudo isso pronto.

## Configuração do serviço

Os flags do `gcloud run deploy` estão fixos no workflow:

| Flag                | Valor   | Por quê                                                                                                             |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| `--min-instances`   | `0`     | Escala a zero: sem tráfego, sem custo. O preço é um cold start no primeiro request.                                   |
| `--max-instances`   | `1`     | **Não aumente sem antes ligar o `@socket.io/redis-adapter`**: as rooms de chat e voz vivem na memória do processo.    |
| `--cpu`             | `1`     |                                                                                                                       |
| `--memory`          | `512Mi` |                                                                                                                       |
| `--concurrency`     | `500`   | Cada WebSocket aberto ocupa um slot de concorrência enquanto durar a conexão — este número é o teto de sockets vivos. |
| `--timeout`         | `3600`  | Máximo do Cloud Run. É o que corta um WebSocket em 60 min; o cliente reconecta e refaz `voice:join`.                  |
| `--cpu-throttling`  | —       | Billing por request (CPU só durante o request). É o default, explicitado para não depender dele.                      |
| `--port`            | `8080`  | O Cloud Run injeta `PORT`; o `main.ts` lê `process.env.PORT`.                                                          |
| `--allow-unauthenticated` | — | A auth é o JWT da própria aplicação, não o IAM do Cloud Run.                                                          |

## 1. Projeto e APIs

```bash
gcloud config set project SEU_PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  sqladmin.googleapis.com   # só se usar Cloud SQL (conector e Auth Proxy)
```

## 2. Artifact Registry

```bash
gcloud artifacts repositories create agree \
  --repository-format=docker \
  --location=southamerica-east1 \
  --description="Imagens do agree-server"
```

O nome (`agree`) e a região precisam bater com as variáveis `AR_REPOSITORY` e
`GCP_REGION` do GitHub (defaults abaixo).

## 3. Secrets no Secret Manager

O workflow monta o serviço com três secrets obrigatórias, com estes nomes:

```bash
printf '%s' 'postgresql://...' | gcloud secrets create agree-database-url --data-file=-
printf '%s' 'mongodb+srv://...' | gcloud secrets create agree-mongodb-uri  --data-file=-
printf '%s' "$(openssl rand -hex 32)" | gcloud secrets create agree-jwt-secret --data-file=-
```

Para rotacionar depois: `gcloud secrets versions add agree-jwt-secret --data-file=-`
(o serviço aponta para `:latest`, então basta um novo deploy — ou uma nova
revisão — para pegar a versão nova).

A **service account de runtime** do serviço (por padrão a
`PROJECT_NUMBER-compute@developer.gserviceaccount.com`) precisa poder ler:

```bash
PROJECT_NUMBER=$(gcloud projects describe SEU_PROJECT_ID --format='value(projectNumber)')
for s in agree-database-url agree-mongodb-uri agree-jwt-secret; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

> O MongoDB precisa ser alcançável pela internet pública (Atlas, e afins): sem
> Serverless VPC Access o Cloud Run não enxerga rede privada, e o IP de saída não
> é fixo — allowlist no Atlas só funciona com `0.0.0.0/0` ou com Direct VPC
> egress + Cloud NAT. O Postgres é o caso especial da seção abaixo.

## 3.1 Cloud SQL (Postgres)

Com Cloud SQL o Postgres **não** é acessado por IP: o Cloud Run anexa o conector
do Cloud SQL e monta um socket Unix em `/cloudsql/<connection name>`. Duas peças
que só funcionam juntas:

1. A connection string do secret `agree-database-url` aponta para esse socket —
   o `@localhost` existe só para a URL ser válida, quem manda é o `?host=`:

   ```
   postgresql://USUARIO:SENHA@localhost/BANCO?host=/cloudsql/PROJECT:REGION:INSTANCIA
   ```

   A senha precisa ser percent-encoded se tiver `@ : / ? # & %`
   (`[uri]::EscapeDataString('...')` no PowerShell). Os `:` do connection name
   ficam como estão.

2. A variável `CLOUDSQL_INSTANCE` no GitHub (o connection name, ex.
   `meu-projeto:us-east1:agree-db`) faz o workflow passar
   `--add-cloudsql-instances` no deploy. **Sem ela o socket não existe** e o boot
   morre com `ENOENT /cloudsql/...`. A mesma variável liga o Auth Proxy no job de
   migrations (seção 6).

Banco e usuário dedicados — a instância nova só traz o banco administrativo
`postgres`:

```bash
gcloud sql databases create agree --instance=INSTANCIA
gcloud sql users create agree --instance=INSTANCIA --password='...'
```

Permissões: a SA de **runtime** e a `github-deployer` precisam das duas de
`roles/cloudsql.client` (a primeira para o conector, a segunda para o proxy):

```bash
for m in "${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
         "github-deployer@SEU_PROJECT_ID.iam.gserviceaccount.com"; do
  gcloud projects add-iam-policy-binding SEU_PROJECT_ID \
    --member="serviceAccount:$m" --role="roles/cloudsql.client"
done
```

Nada disso exige liberar o IP público da instância — as redes autorizadas podem
ficar vazias.

## 4. Service account de deploy (usada pelo GitHub)

```bash
gcloud iam service-accounts create github-deployer \
  --display-name="GitHub Actions — deploy do agree-server"

SA="github-deployer@SEU_PROJECT_ID.iam.gserviceaccount.com"

# Publicar imagem no Artifact Registry
gcloud projects add-iam-policy-binding SEU_PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/artifactregistry.writer"

# Criar revisões do Cloud Run
gcloud projects add-iam-policy-binding SEU_PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/run.admin"

# Necessária para o deploy conseguir rodar o serviço como a SA de runtime
gcloud iam service-accounts add-iam-policy-binding \
  "${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --member="serviceAccount:$SA" --role="roles/iam.serviceAccountUser"
```

Chave JSON para o GitHub:

```bash
gcloud iam service-accounts keys create key.json --iam-account="$SA"
# cole o conteúdo em Settings → Secrets and variables → Actions → New secret
# nome: GCP_SA_KEY   — e apague o key.json local depois
```

> Preferível, quando puder configurar: **Workload Identity Federation**, que
> dispensa a chave. O bloco já está no workflow, comentado — troque
> `credentials_json` por `workload_identity_provider` + `service_account` e
> defina as variáveis `GCP_WIF_PROVIDER` / `GCP_DEPLOYER_SA`.

## 5. Secrets e variáveis no GitHub

**Secrets** (Settings → Secrets and variables → Actions → _Secrets_):

| Nome           | Conteúdo                                                                       |
| -------------- | ------------------------------------------------------------------------------ |
| `GCP_SA_KEY`   | JSON da chave da `github-deployer`, o arquivo inteiro (passo 4)                 |
| `DATABASE_URL` | Connection string usada **pelo job de migrations** — com Cloud SQL, a do proxy (passo 6) |

**Variables** (mesma tela, aba _Variables_):

| Nome                    | Obrigatória | Default do workflow   |
| ----------------------- | ----------- | --------------------- |
| `GCP_PROJECT_ID`        | **sim**     | —                     |
| `CLOUDSQL_INSTANCE`     | com Cloud SQL | vazio (sem conector, sem proxy) |
| `GCP_REGION`            | não         | `southamerica-east1`  |
| `CLOUD_RUN_SERVICE`     | não         | `agree-server`        |
| `AR_REPOSITORY`         | não         | `agree`               |
| `ORIGIN`                | recomendada | vazio (reflete qualquer origem) |
| `CLOUDSQL_PROXY_VERSION`| não         | `2.15.2`              |

As variáveis de voz (`VOICE_MESH_MAX`, `VIDEO_MESH_MAX`,
`VOICE_MAX_AUDIO_BITRATE`, `VOICE_UPLINK_BUDGET`, `TURN_URL`, `TURN_USER`,
`CF_TURN_KEY_ID`, `CF_TURN_TTL`, `STUN_URL`) são opcionais e só entram no
`--set-env-vars` quando definidas — vazia significa ausente, para o default de
`src/common/env.ts` valer.

Os valores **sensíveis** de voz (`TURN_PASS`, `CF_TURN_KEY_API_TOKEN`) não devem
virar variável: crie no Secret Manager e liste em `EXTRA_SECRETS`, que o
workflow concatena na flag `--set-secrets`. Ex.:

```
EXTRA_SECRETS = TURN_PASS=agree-turn-pass:latest,CF_TURN_KEY_API_TOKEN=agree-cf-turn-token:latest
```

Há também `EXTRA_ENV_VARS` (mesmo formato, `A=1@@B=2`) para qualquer env var
futura sem mexer no workflow.

## 6. Migrações do Postgres

O job `migrate` roda `npx drizzle-kit migrate` **entre o `test` e o `deploy`** —
nessa ordem porque a revisão nova pode consultar coluna que só passa a existir
depois da migration. Se a migration falhar, o deploy não acontece.

**Com Cloud SQL** (quando `CLOUDSQL_INSTANCE` está definida) o job baixa o
**Cloud SQL Auth Proxy**, sobe o túnel em `127.0.0.1:5432` autenticado pela
`github-deployer`, e só então roda o `drizzle-kit`. O runner não tem o socket
`/cloudsql/...` que o Cloud Run monta, e a alternativa — liberar o IP público
para os IPs dinâmicos do GitHub — seria `0.0.0.0/0` nas redes autorizadas.

Por isso a secret `DATABASE_URL` do GitHub **não** é igual ao secret
`agree-database-url` do Secret Manager: mesma credencial, transporte diferente.

| Onde                          | String                                                              |
| ----------------------------- | ------------------------------------------------------------------- |
| `agree-database-url` (runtime) | `postgresql://user:senha@localhost/agree?host=/cloudsql/PROJECT:REGION:INSTANCIA` |
| `DATABASE_URL` (migrations)   | `postgresql://user:senha@127.0.0.1:5432/agree`                       |

Ao rotacionar a senha do banco, troque nos dois lugares.

Sem `CLOUDSQL_INSTANCE` os steps do proxy são pulados e a `DATABASE_URL` é usada
direto — o caso de um Postgres gerenciado fora do GCP (Neon, Supabase), que
aceita conexão da internet por padrão.

Nada disso vale para o **MongoDB**: não há migrations: o Mongoose cria as
collections na primeira escrita e monta os índices dos schemas no boot. O
`yarn mongodb:seed` é dado fake de desenvolvimento e **não** deve ser apontado
para produção.

> As migrations não entram na imagem: o `.dockerignore` exclui `drizzle/` e o
> `drizzle-kit` é devDependency, podada no estágio de produção. Rodar migration
> na subida do container seria pior aqui — com `min-instances=0`, toda instância
> fria pagaria por isso.

## Depois do primeiro deploy

- A URL sai no _summary_ do job (`https://agree-server-XXXX.run.app`); o Swagger
  fica em `/api`.
- Coloque essa URL de origem do front em `ORIGIN`, e a URL do front no CORS.
- O cookie `agree_token` ainda sai como `sameSite: 'lax'`
  (`src/modules/auth/token-cookie.ts`), o que não sobrevive a front e back em
  domínios diferentes — é o primeiro item do [TODO.md](../TODO.md).
- `yarn start:prod` (`node dist/main`) está desatualizado: como o
  `drizzle.config.ts` da raiz entra no build, a saída é `dist/src/main.js` — que
  é o que o `Dockerfile` executa.

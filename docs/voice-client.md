# Voz no front — guia de implementação (mesh P2P + SFU)

Este documento é o contrato entre o front e o módulo `voice` do backend. O
desenho e as razões por trás dele estão em [voice-webrtc.md](./voice-webrtc.md);
aqui só está o que o cliente precisa fazer. As seções até "Endpoint REST" são a
Fase 1 (mesh, só áudio) e continuam valendo; o que muda quando a sala vai para o
SFU está em [Fase 2 — SFU](#fase-2--sfu-vídeo-screenshare-e-salas-grandes).

## O que o servidor faz — e o que ele não faz

O servidor **não toca no áudio**. Cloud Run não passa UDP, então não existe SFU
próprio: o áudio vai direto browser↔browser via `RTCPeerConnection`. O backend
só faz três coisas:

1. diz **quem está** no canal;
2. **repassa** SDP/ICE entre dois peers que já estão na mesma sala;
3. entrega as credenciais de **STUN/TURN** e um **teto de bitrate**.

Consequências práticas para o front:

- Toda a máquina de estado do WebRTC é sua. O servidor nunca lê um SDP.
- Mute/deafen são **cosméticos** no servidor — ele guarda o flag só para quem
  entrar depois renderizar o ícone certo. Silenciar de verdade é responsabilidade
  do cliente (`track.enabled = false`).
- O mesh é **só áudio** e vai até **5 participantes** (`VOICE_MESH_MAX`). Com
  o SFU configurado no backend, o 6º não é recusado: a sala inteira migra para o
  SFU. Vídeo e screenshare **sempre** vão pelo SFU. Sem SFU configurado
  (`ack.video === null`), o 6º recebe erro no join e não há vídeo.

---

## Conexão

O gateway de voz vive no namespace `/voice`, **na mesma porta e na mesma conexão
TCP** do `/chat` — o cliente socket.io reutiliza um `Manager` por URL, então
manter os dois abertos não custa uma segunda conexão.

```ts
import { io } from 'socket.io-client';

const socket = io(`${API_URL}/voice`, {
  withCredentials: true, // manda o cookie httpOnly `agree_token` no handshake
});
```

Autenticação, na ordem em que o servidor procura o JWT:

1. header `Authorization: Bearer <token>`;
2. `auth: { token }` no handshake;
3. cookie `agree_token` (é o caminho do agree-app — o browser anexa sozinho,
   basta `withCredentials: true`).

Se o token faltar ou for inválido o servidor emite `error` com
`{ status: 'error', message: 'Unauthorized' }` e **desconecta** o socket. Não
tente reconectar sem renovar o login — o JWT dura 7 dias e não há refresh.

> `ORIGIN` no backend precisa listar a origem do front, senão o CORS derruba o
> handshake antes de qualquer autenticação.

---

## Protocolo

### Cliente → servidor

Todo handler responde por **ack** (callback do socket.io). Use `emitWithAck`.

| Evento | Payload | Ack |
| --- | --- | --- |
| `voice:join` | `{ channelId }` | `VoiceJoinAck` (abaixo) |
| `voice:leave` | `{ channelId }` | `{ status: 'left', channelId }` |
| `voice:signal` | `{ channelId, targetUserId, kind, payload }` | `{ status: 'sent' }` |
| `voice:state` | `{ channelId, muted, deafened }` | `VoiceParticipant` atualizado |
| `voice:watch` | `{ serverId }` | `VoiceWatchAck` (abaixo) — snapshot de todos os canais de voz do servidor |
| `voice:unwatch` | `{ serverId }` | `{ status: 'unwatched', serverId }` |

`kind` é `'offer' | 'answer' | 'candidate'`. `payload` é um
`RTCSessionDescriptionInit` ou `RTCIceCandidateInit` — o servidor repassa
intacto, sem olhar dentro.

`channelId` e `targetUserId` precisam ser ObjectIDs Mongo válidos (24 hex); o
DTO rejeita qualquer outra coisa antes de chegar no handler.

### Servidor → cliente

| Evento | Payload | O que fazer |
| --- | --- | --- |
| `voice:peer-joined` | `{ channelId, participant }` | Adiciona no roster. **Não ofereça** — quem chega é que oferece. |
| `voice:peer-left` | `{ channelId, participant }` | Fecha o `RTCPeerConnection` daquele peer e remove o `<audio>`. |
| `voice:signal` | `{ channelId, fromUserId, kind, payload }` | Alimenta a negociação (ver fluxo abaixo). |
| `voice:state-changed` | `{ channelId, participant }` | Atualiza ícone de mute/deafen. |
| `voice:presence` | `{ serverId, channelId, participants }` | Só para quem fez `voice:watch` nesse servidor. Roster **completo** do canal — substitua o que você tinha, sem diff. |
| `voice:evicted` | `{ channelId, reason: 'joined-from-another-device' }` | Você entrou em outra aba/dispositivo. Este socket vai cair logo em seguida — mostre o aviso e **não** reconecte automaticamente. |
| `error` | `{ status: 'error', message, ...}` | Ver "Erros". |

### Tipos

```ts
type VoiceParticipant = {
  socketId: string;
  userId: string;
  username: string;
  serverId: string; // servidor dono do canal
  muted: boolean;
  deafened: boolean;
  joinedAt: string; // ISO8601 — dá pra ordenar o roster por chegada
  tracks: VoiceTrack[]; // o que ele publica no SFU; sempre [] no mesh
};

type VoiceTrack = {
  trackName: 'mic' | 'camera' | 'screen' | 'screen-audio'; // = source
  source: 'mic' | 'camera' | 'screen' | 'screen-audio';
  kind: 'audio' | 'video';
  contentHint?: 'detail' | 'motion'; // só screen
  rids: ('f' | 'h' | 'q')[]; // camadas de simulcast, melhor primeiro; [] no áudio
};

type SimulcastProfile = {
  capture: { width: number; height: number; frameRate: number };
  encodings: { rid: 'f' | 'h' | 'q'; maxBitrate: number; maxFramerate: number; scaleResolutionDownBy: number }[];
};

type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

type VoiceJoinAck = {
  channelId: string;
  selfId: string;    // seu userId — é por ele que os peers te endereçam
  socketId: string;
  topology: 'mesh' | 'sfu';
  participants: VoiceParticipant[]; // quem JÁ estava lá, sem você
  iceServers: IceServer[];
  bitrate: { audio: { maxBitrate: number } };
  // null = backend sem SFU: sem vídeo, sala enche em VOICE_MESH_MAX
  video: {
    codecs: string[]; // ['VP8'] — restrinja a offer a isso
    profiles: { camera: SimulcastProfile; screenDetail: SimulcastProfile; screenMotion: SimulcastProfile };
  } | null;
};

type VoiceWatchAck = {
  serverId: string;
  // Um par por canal de voz do servidor, inclusive os vazios ([]).
  channels: Record<string, VoiceParticipant[]>;
};
```

---

## Erros — leia esta parte antes de escrever o join

**Erros não voltam pelo ack.** O `WsGlobalExceptionFilter` do backend emite o
erro no evento `error` do socket e o ack **nunca é chamado**. Um
`await socket.emitWithAck(...)` sem timeout fica pendurado para sempre.

Sempre use `.timeout()`:

```ts
const ack = await socket.timeout(10_000).emitWithAck('voice:join', { channelId });
```

E escute `error` em paralelo:

```ts
socket.on('error', (e: { status: string; message: string }) => {
  // "You are not a member of this channel's server"
  // "This channel is not a voice channel"
  // "This voice channel is full (5 participants)"   (25 com SFU: VOICE_SFU_MAX)
  // "Join this voice channel first"
  // "That peer is not in this voice channel"
  // "This voice channel is on the media server, not peer to peer"  → voice:signal numa sala SFU
  // "Unauthorized"  → o socket também será desconectado
  // ...e os do SFU, listados na seção da Fase 2
});
```

O `message` é a única coisa estável — não há código de erro. Como o canal `error`
é global do socket, correlacionar erro↔request exige guardar o que você acabou
de emitir (ou simplesmente tratar qualquer `error` durante o join como falha de
join).

Note que **não-membro, canal inexistente e id malformado dão a mesma mensagem** —
é proposital, para um estranho não conseguir descobrir quais canais existem.

---

## Fluxo de negociação

A regra que mantém isso simples: **quem chega oferece, quem já estava só
responde.** Não existe offer simultâneo, então não é preciso perfect negotiation
nem rollback.

```
Você entra                                  Peer que já estava lá
──────────                                  ─────────────────────
voice:join ──────────────────────────────►
       ◄──── ack { participants, iceServers, bitrate }
                                             ◄──── voice:peer-joined (você)
para CADA participante do ack:
  cria RTCPeerConnection
  addTrack(mic)
  createOffer / setLocalDescription
  voice:signal { kind:'offer' } ─────────►
                                             cria RTCPeerConnection
                                             addTrack(mic)
                                             setRemoteDescription(offer)
                                             createAnswer
                                      ◄───── voice:signal { kind:'answer' }
  setRemoteDescription(answer)
  ◄──── candidates trocados nos dois sentidos ────►
  ontrack → <audio autoplay>
```

Quem já estava na sala recebe `voice:peer-joined` **antes** da offer chegar. Use
esse evento só para atualizar a lista visual — criar a conexão é reação ao
`voice:signal` com `kind: 'offer'`.

### Duas armadilhas clássicas

**1. Candidate chegando antes da offer.** ICE trickle é assíncrono; um
`candidate` pode chegar antes do `setRemoteDescription`, e aí
`addIceCandidate` rejeita. Enfileire:

```ts
if (pc.remoteDescription) await pc.addIceCandidate(payload);
else pending.get(fromUserId)!.push(payload);
```

**2. Autoplay.** Anexar o stream remoto num `<audio autoplay>` pode ser bloqueado
se não houve gesto do usuário. Clicar em "entrar no canal" conta como gesto, mas
trate a rejeição de `audio.play()` mesmo assim.

---

## Implementação de referência

```ts
import { io, Socket } from 'socket.io-client';

type Kind = 'offer' | 'answer' | 'candidate';

export class VoiceClient {
  private socket!: Socket;
  private local!: MediaStream;
  private selfId!: string;
  private channelId!: string;
  private iceServers: RTCIceServer[] = [];
  private maxBitrate = 40_000;

  private peers = new Map<string, RTCPeerConnection>();
  private pending = new Map<string, RTCIceCandidateInit[]>();

  async join(apiUrl: string, channelId: string) {
    this.channelId = channelId;

    // Pegue o microfone ANTES do join: se o usuário negar a permissão, você
    // ainda não anunciou presença para ninguém.
    this.local = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });

    this.socket = io(`${apiUrl}/voice`, { withCredentials: true });
    this.bind();

    await new Promise<void>((res) => this.socket.on('connect', () => res()));

    const ack = await this.socket
      .timeout(10_000)
      .emitWithAck('voice:join', { channelId });

    this.selfId = ack.selfId;
    this.iceServers = ack.iceServers;
    this.maxBitrate = ack.bitrate.audio.maxBitrate;

    // Você é o novato: oferece para todo mundo que já estava.
    for (const p of ack.participants) await this.offerTo(p.userId);
  }

  private bind() {
    this.socket.on('voice:signal', (m) => void this.onSignal(m));
    this.socket.on('voice:peer-left', ({ participant }) => this.closePeer(participant.userId));
    this.socket.on('voice:evicted', () => this.teardown()); // outra aba assumiu
    this.socket.on('error', (e) => console.error('[voice]', e.message));

    // Reconexão: o servidor já limpou sua presença no disconnect, então é um
    // join novo — e todas as conexões antigas estão mortas.
    this.socket.io.on('reconnect', () => void this.rejoin());
  }

  private peer(userId: string): RTCPeerConnection {
    const existing = this.peers.get(userId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peers.set(userId, pc);
    this.pending.set(userId, []);

    for (const track of this.local.getTracks()) pc.addTrack(track, this.local);
    this.applyBitrate(pc);

    pc.onicecandidate = (e) => {
      if (e.candidate) void this.send(userId, 'candidate', e.candidate.toJSON());
    };
    pc.ontrack = (e) => this.attachAudio(userId, e.streams[0]);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
    };

    return pc;
  }

  private async offerTo(userId: string) {
    const pc = this.peer(userId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.send(userId, 'offer', offer);
  }

  private async onSignal({ fromUserId, kind, payload }: { fromUserId: string; kind: Kind; payload: any }) {
    const pc = this.peer(fromUserId);

    if (kind === 'offer') {
      await pc.setRemoteDescription(payload);
      await this.flush(fromUserId, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.send(fromUserId, 'answer', answer);
      return;
    }

    if (kind === 'answer') {
      await pc.setRemoteDescription(payload);
      await this.flush(fromUserId, pc);
      return;
    }

    // candidate — pode chegar antes da remote description
    if (pc.remoteDescription) await pc.addIceCandidate(payload);
    else this.pending.get(fromUserId)!.push(payload);
  }

  private async flush(userId: string, pc: RTCPeerConnection) {
    const queued = this.pending.get(userId) ?? [];
    this.pending.set(userId, []);
    for (const c of queued) await pc.addIceCandidate(c);
  }

  private send(targetUserId: string, kind: Kind, payload: unknown) {
    return this.socket
      .timeout(5_000)
      .emitWithAck('voice:signal', { channelId: this.channelId, targetUserId, kind, payload });
  }

  /** O teto é aplicado pelo cliente — o servidor só publica a política. */
  private applyBitrate(pc: RTCPeerConnection) {
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== 'audio') continue;
      const params = sender.getParameters();
      params.encodings ??= [{}];
      params.encodings[0].maxBitrate = this.maxBitrate;
      void sender.setParameters(params);
    }
  }

  setMuted(muted: boolean, deafened = false) {
    for (const t of this.local.getAudioTracks()) t.enabled = !muted && !deafened;
    // deafen também precisa silenciar os <audio> remotos — é só client-side.
    void this.socket.timeout(5_000).emitWithAck('voice:state', {
      channelId: this.channelId, muted, deafened,
    });
  }

  private attachAudio(userId: string, stream: MediaStream) { /* <audio autoplay> por userId */ }
  private closePeer(userId: string) {
    this.peers.get(userId)?.close();
    this.peers.delete(userId);
    this.pending.delete(userId);
  }
  private async rejoin() { /* fecha todos os peers e repete o join */ }
  private teardown() { /* fecha peers, para as tracks, desconecta */ }

  async leave() {
    await this.socket.timeout(5_000).emitWithAck('voice:leave', { channelId: this.channelId });
    this.teardown();
  }
}
```

---

## Reconexão — não é opcional

Cloud Run corta qualquer request com **60 minutos**, e um WebSocket aberto *é*
uma request. Uma chamada longa **vai** cair. Além disso qualquer queda de rede
dispara o mesmo caminho.

Quando o socket cai, o servidor roda o `handleDisconnect`: limpa sua presença e
avisa `voice:peer-left` para os outros. Então, ao reconectar:

1. **Feche todos os `RTCPeerConnection`** — eles estão mortos, e a presença
   antiga já foi apagada no servidor.
2. Emita `voice:join` de novo.
3. Ofereça para todos do novo `ack.participants`.

O socket.io reconecta sozinho, mas ele **não** refaz o `voice:join` — isso é seu.
Não reaproveite peer connections entre reconexões: os `socketId` do outro lado
mudaram.

Um `voice:join` repetido pelo **mesmo socket** que já está na sala é idempotente:
o servidor devolve o ack de novo sem reanunciar você. Já um join do **mesmo
usuário por outro socket** derruba o socket anterior (`voice:evicted`) — é o
comportamento do Discord, e existe para você não ouvir a si mesmo com duas abas.

---

## Endpoint REST

Para pintar "3 pessoas nesse canal" na lista antes de alguém entrar:

```
GET /voice/:channelId/participants
Authorization: Bearer <jwt>

→ { channelId, topology: 'mesh', participants: VoiceParticipant[] }
```

Tem o próprio gate de membership (retorna 400 para não-membro ou canal que não
seja `VOICE`). Para a lista **viva**, prefira `voice:watch` (abaixo) — o REST
fica como fallback para quem não tem socket aberto.

---

## Presença server-wide (`voice:watch`)

Para a sidebar mostrar quem está em cada canal de voz sem ninguém precisar
entrar na call:

1. Abra um socket no namespace `/voice` (pode ser um socket **separado** do da
   chamada — ele nunca entra em `voice:<channelId>`, então não interfere na
   regra de "um socket por usuário por canal").
2. `emitWithAck('voice:watch', { serverId })` → o ack é o snapshot inicial
   (`VoiceWatchAck`), com todos os canais `voice` do servidor, vazios inclusive.
3. A partir daí, cada mudança (join, leave, mute/deafen, queda de socket) chega
   como `voice:presence { serverId, channelId, participants }`. É o roster
   inteiro daquele canal: substitua, não faça merge.
4. Ao trocar de servidor, `voice:unwatch` no anterior e `voice:watch` no novo.
5. **Reconexão perde as rooms.** No `connect` do socket, re-emita `voice:watch`
   do servidor atual — o ack já traz o estado que você perdeu.

O gate é membership no servidor (400 para não-membro ou servidor inexistente,
sem distinguir os dois). Só o dono do socket que fez `watch` recebe; quem está
na call recebe os eventos `voice:peer-*` normalmente e, se também estiver
observando, o `voice:presence` do mesmo canal — os dois são consistentes.

---

## Detalhes que costumam morder

- **`iceServers` vem do ack, não hardcode.** Em dev sem TURN configurado vem só
  STUN, e aí ~15–20% dos usuários (NAT simétrico) não conectam. Isso é esperado
  localmente; não é bug.
- **Testar TURN de verdade** exige `iceTransportPolicy: 'relay'` no
  `RTCPeerConnection` — sem isso, em localhost os candidatos host resolvem tudo e
  você não sabe se o TURN funciona.
- **`bitrate` só vem no ack do join** e não é reemitido quando a sala cresce. Com
  a config padrão isso não muda nada (o teto dá 40 kbps em qualquer tamanho de
  mesh até 5), então aplique o valor do ack e siga. Só importa se o backend
  configurar `VOICE_UPLINK_BUDGET` baixo.
- **Não implemente bitrate adaptativo.** O GCC/TWCC do próprio WebRTC já adapta
  continuamente; `maxBitrate` é teto, não alvo.
- **`targetUserId` é userId, não socketId.** Peers se endereçam por usuário; o
  servidor resolve para o socket certo — inclusive para não vazar a negociação
  para outras abas daquele usuário.
- **Cheque `topology` no ack.** Com SFU configurado no backend ela pode vir
  `'sfu'` já no join (o 6º a entrar, ou uma sala com vídeo). Um cliente que só
  fala mesh precisa falhar explicitamente — o servidor recusa `voice:signal`
  numa sala SFU, então assumir mesh deixa a chamada muda.

## Fase 2 — SFU (vídeo, screenshare e salas grandes)

Só existe se o backend tiver `CF_REALTIME_APP_ID`/`CF_REALTIME_APP_SECRET` —
o sinal para o front é `ack.video !== null`. Sem isso, esconda câmera e
screenshare.

### O que muda

No SFU cada cliente tem **um** `RTCPeerConnection`, com a Cloudflare do outro
lado, e não com cada peer. Você **publica** suas tracks nele e **puxa** as dos
outros. O backend faz de proxy para toda chamada à Cloudflare (o secret do app
nunca chega no browser), então todo passo é um evento no socket `/voice`, com
ack, como no mesh.

A sala vai para o SFU quando:
- entra o 6º participante (o ack vem `topology: 'sfu'`, e quem já estava recebe
  `voice:topology-changed`); ou
- alguém liga câmera/screenshare numa sala mesh (quem publicou vídeo recebe
  `voice:topology-changed` também).

É **só num sentido**: a sala só volta para mesh quando esvazia.

### Eventos

Cliente → servidor (todos exigem já ter feito `voice:join`):

| Evento | Payload | Ack |
| --- | --- | --- |
| `voice:sfu:publish` | `{ channelId, sessionDescription: offer, tracks: [{ mid, source, contentHint? }] }` | `{ sessionDescription: answer, tracks: [{ mid, trackName }] }` |
| `voice:sfu:pull` | `{ channelId, tracks: [{ userId, trackName, preferredRid? }] }` (até 64) | `{ sessionDescription?: offer, requiresImmediateRenegotiation, tracks: [{ mid, userId, trackName }] }` |
| `voice:sfu:renegotiate` | `{ channelId, sessionDescription: answer }` | `{ status: 'renegotiated' }` |
| `voice:sfu:close` | `{ channelId, mids: string[] }` (**sem** offer) | `{ status: 'closed', mids }` |
| `voice:sfu:layer` | `{ channelId, mid, preferredRid }` | `{ status: 'updated', mid, preferredRid }` |

Servidor → cliente:

| Evento | Payload | O que fazer |
| --- | --- | --- |
| `voice:topology-changed` | `{ channelId, topology: 'sfu' }` | Migrar (ver abaixo). |
| `voice:track-published` | `{ channelId, userId, track: VoiceTrack }` | Puxar (áudio sempre; vídeo quando o tile estiver visível). |
| `voice:track-unpublished` | `{ channelId, userId, trackName }` | `voice:sfu:close` no mid que você puxou dessa track, e remover o tile. |
| `voice:peer-left` | (igual ao mesh) | Fechar **todos** os mids que você puxou desse `userId`. |

`source` ∈ `mic | camera | screen | screen-audio`. Cada participante publica
**no máximo uma track por source**. `contentHint` é obrigatório no `screen`:
`'detail'` para texto/código, `'motion'` para vídeo/jogo. As tracks são
endereçadas por `{ userId, trackName }` — você nunca vê um id de sessão da
Cloudflare.

### Regra de ouro: uma negociação por vez

Publish, pull e close mexem no **mesmo** PC. Se dois se cruzarem (offer sua
enquanto a Cloudflare te manda outra), o PC entra em `have-local-offer` com uma
offer remota chegando e quebra. Ponha tudo numa fila:

```ts
private queue = Promise.resolve();
private negotiate<T>(step: () => Promise<T>): Promise<T> {
  const run = this.queue.then(step, step);
  this.queue = run.then(() => undefined, () => undefined);
  return run;
}
```

### Publicar (mic, câmera, screenshare)

O servidor **inspeciona a offer** e recusa se ela não bater com a política:
- vídeo só **VP8**, áudio só **Opus** — a offer não pode nem *oferecer* outros
  (rtx/red/ulpfec são tolerados). Use `setCodecPreferences`;
- o vídeo precisa declarar simulcast com **exatamente** as camadas do perfil
  (`camera` e `screenMotion`: `f;h;q`; `screenDetail`: `f;h`). Use as
  `encodings` do ack como `sendEncodings`.

```ts
const AUX = ['rtx', 'red', 'ulpfec', 'flexfec-03'];

function restrictCodecs(t: RTCRtpTransceiver, kind: 'audio' | 'video', allowed: string[]) {
  const ok = allowed.map((c) => c.toLowerCase());
  const codecs = RTCRtpReceiver.getCapabilities(kind)!.codecs.filter((c) => {
    const name = c.mimeType.split('/')[1].toLowerCase();
    return ok.includes(name) || AUX.includes(name);
  });
  t.setCodecPreferences(codecs);
}

async publish(sources: { track: MediaStreamTrack; source: Source; contentHint?: 'detail' | 'motion' }[]) {
  return this.negotiate(async () => {
    const added = sources.map(({ track, source, contentHint }) => {
      const video = track.kind === 'video';
      const profile = source === 'camera' ? 'camera'
        : contentHint === 'motion' ? 'screenMotion' : 'screenDetail';
      if (source === 'screen') track.contentHint = contentHint!;

      const t = this.pc.addTransceiver(track, {
        direction: 'sendonly',
        ...(video ? { sendEncodings: this.video!.profiles[profile].encodings } : {}),
      });
      restrictCodecs(t, track.kind as 'audio' | 'video', video ? this.video!.codecs : ['opus']);
      return { t, source, contentHint };
    });

    await this.pc.setLocalDescription(await this.pc.createOffer());

    // O mid só existe DEPOIS do setLocalDescription.
    const ack = await this.socket.timeout(10_000).emitWithAck('voice:sfu:publish', {
      channelId: this.channelId,
      sessionDescription: this.pc.localDescription,
      tracks: added.map(({ t, source, contentHint }) => ({
        mid: t.mid, source, ...(source === 'screen' ? { contentHint } : {}),
      })),
    });

    await this.pc.setRemoteDescription(ack.sessionDescription);
    return ack.tracks; // guarde mid → source, para o close depois
  });
}
```

Capture com as constraints do perfil
(`getUserMedia({ video: profiles.camera.capture })`,
`getDisplayMedia({ video: profiles.screenDetail.capture })`) — as camadas
(`scaleResolutionDownBy`) são relativas ao que foi capturado.

Os `maxBitrate` das camadas são uma **política**: o servidor não consegue
verificá-los (não aparecem no SDP), mas aplique como vieram.

### Puxar

```ts
async pull(wanted: { userId: string; trackName: string; preferredRid?: 'f' | 'h' | 'q' }[]) {
  return this.negotiate(async () => {
    const ack = await this.socket.timeout(10_000).emitWithAck('voice:sfu:pull', {
      channelId: this.channelId, tracks: wanted,
    });

    if (ack.requiresImmediateRenegotiation) {
      await this.pc.setRemoteDescription(ack.sessionDescription);
      await this.pc.setLocalDescription(await this.pc.createAnswer());
      await this.socket.timeout(10_000).emitWithAck('voice:sfu:renegotiate', {
        channelId: this.channelId, sessionDescription: this.pc.localDescription,
      });
    }

    // ack.tracks[i].mid → this.pc.getTransceivers().find(t => t.mid === mid)!.receiver.track
    return ack.tracks;
  });
}
```

- Sem `preferredRid`, o vídeo vem na camada **mais barata** (`q`, ou `h` num
  screen `detail`). Peça mais pelo tamanho do tile.
- Puxar a mesma track duas vezes é recusado — guarde o que você já puxou.
- Um `preferredRid` que a track não tem é recusado: consulte `track.rids`.

### Trocar de camada

Ao redimensionar um tile (com throttle — não a cada frame de resize):

```ts
void this.socket.timeout(5_000).emitWithAck('voice:sfu:layer', { channelId, mid, preferredRid });
```

Sugestão para câmera: altura renderizada ≥ 540px → `f`, ≥ 270px → `h`, senão
`q`. Para screenshare `detail`, `f` quando o tile é o foco e `h` na grade. A
Cloudflare continua baixando a camada sozinha sob congestionamento.

### Desligar câmera / parar screenshare

**Feche a track no servidor**, não basta `track.stop()`. A Cloudflare descarta
uma track 30 s depois que os pacotes param, mas a presença continuaria
anunciando uma track morta para todo mundo.

O close **não renegocia** e não leva offer. Aposente o transceiver no lugar,
sem `stop()`:

```ts
await this.negotiate(async () => {
  const mid = transceiver.mid; // leia antes de aposentar
  await transceiver.sender.replaceTrack(null); // para de mandar na hora
  transceiver.direction = 'inactive';          // nunca stop() — ver abaixo
  await this.socket.timeout(10_000).emitWithAck('voice:sfu:close', {
    channelId, mids: [mid],
  });
});
```

**Fechar um pull** (de um peer que saiu, `peer-left` / `track-unpublished`) é o
**mesmo fluxo**, nos transceivers recvonly desses mids. Dá para fechar vários
mids numa chamada só (até 64).

> **Nunca chame `transceiver.stop()` num transceiver já negociado.** Ele põe a
> m-section em porta 0 na sua próxima offer, o que libera o slot para
> *m-line recycling*: a Cloudflare reaproveita aquele mid na offer seguinte
> dela (um pull) renumerando os `a=extmap`, e o Chrome — que guarda o mapa de
> header extensions **por mid** pela vida do `RTCPeerConnection` — recusa com
> `RTP extension ID reassignment not supported (collision on active MID n)`.
> Isso envenena o PC inteiro: dali em diante toda negociação estoura o mesmo
> erro, `createOffer` incluído, e nem o close desfaz. Era o bug de reabrir uma
> live. `inactive` mantém o slot ocupado, então nenhum mid volta a ficar livre.
> O preço é uma m-section morta por track fechada (sem encoder, sem banda). Se
> a Cloudflare reaproveitar um desses transceivers num pull, o `ontrack` não
> dispara de novo — pegue a track de `transceiver.receiver.track`.
>
> Se uma negociação falhar mesmo assim, teste o PC com um `createOffer()`: se
> ele estourar, o PC não tem mais volta — refaça a sessão (`voice:leave` +
> `voice:join`), porque a sessão da Cloudflare é presa a esse PC.

### Migração (`voice:topology-changed`)

1. Feche todos os `RTCPeerConnection` do mesh e remova os `<audio>` deles.
2. Crie o PC do SFU com os `iceServers` que você já tem — ou reaproveite, se foi
   você quem ligou o vídeo e disparou a promoção.
3. Publique o mic (`source: 'mic'`).
4. Puxe o `mic` (e o vídeo visível) de todo participante do roster cujo
   `tracks` já tenha algo; o resto chega por `voice:track-published`.

Há um corte de áudio de ~1 s na migração. Ele acontece uma vez só por sala.

Quem entra numa sala que **já** está no SFU faz os passos 2–4 direto a partir
do ack, sem mesh e sem oferecer para ninguém.

### Erros do SFU

Todos chegam pelo evento `error`, como no mesh:

```
"This voice channel is peer to peer; audio goes over voice:signal"   → publish só de áudio numa sala mesh
"Video is not available on this server"                             → backend sem SFU
"This voice channel is not on the media server"                      → pull/close/layer numa sala mesh
"A camera track must offer only VP8 (got vp8, vp9, h264)"             → faltou setCodecPreferences
"A screen track must simulcast exactly f;h (got f;h;q)"               → sendEncodings errado para o perfil
"A camera track must be video, but mid 0 is audio"
"The offer has no media section for mid 3"
"You are already publishing a camera track"
"Cannot pull your own track"
"That peer is not publishing camera"
"You are already receiving camera from that peer"
"Layer q is not available on that track (f, h)"
"Unknown track mid 9"
"You have no media session yet"                                       → close/layer/renegotiate antes de publish/pull
"The media server rejected the request"                               → a Cloudflare recusou; detalhe só no log do servidor
```

## Roteiro de teste

1. Duas abas, contas diferentes, mesmo canal `VOICE` — áudio flui nos dois
   sentidos.
2. Mute numa aba → ícone muda na outra (`voice:state-changed`).
3. Fecha uma aba → a outra recebe `voice:peer-left` em ~1s.
4. Terceira aba com a **mesma** conta da primeira → a primeira recebe
   `voice:evicted` e cai.
5. Canal `TEXT` → `error` com "This channel is not a voice channel".
6. 6º participante → sem SFU, `error` com "This voice channel is full (5
   participants)"; com SFU, os 5 recebem `voice:topology-changed` e o áudio volta
   em ~1 s pelo SFU.
7. `iceTransportPolicy: 'relay'` → ainda conecta (prova o TURN).
8. (SFU) Ligar câmera numa sala mesh de 2 → a sala migra e o outro vê o vídeo.
9. (SFU) Screenshare `detail` num tile pequeno → chega em `h`; tile em foco →
   `voice:sfu:layer` para `f`.
10. (SFU) Desligar câmera → a outra aba recebe `voice:track-unpublished` na hora.

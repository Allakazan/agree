# Voz no front — guia de implementação (Fase 1, mesh P2P)

Este documento é o contrato entre o front e o módulo `voice` do backend. O
desenho e as razões por trás dele estão em [voice-webrtc.md](./voice-webrtc.md);
aqui só está o que o cliente precisa fazer.

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
- Fase 1 é **só áudio** e **no máximo 5 participantes** por canal (`VOICE_MESH_MAX`).
  O 6º recebe erro no join. Vídeo e screenshare são Fase 2.

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
| `voice:evicted` | `{ channelId, reason: 'joined-from-another-device' }` | Você entrou em outra aba/dispositivo. Este socket vai cair logo em seguida — mostre o aviso e **não** reconecte automaticamente. |
| `error` | `{ status: 'error', message, ...}` | Ver "Erros". |

### Tipos

```ts
type VoiceParticipant = {
  socketId: string;
  userId: string;
  username: string;
  muted: boolean;
  deafened: boolean;
  joinedAt: string; // ISO8601 — dá pra ordenar o roster por chegada
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
  topology: 'mesh' | 'sfu'; // sempre 'mesh' na Fase 1
  participants: VoiceParticipant[]; // quem JÁ estava lá, sem você
  iceServers: IceServer[];
  bitrate: { audio: { maxBitrate: number } };
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
  // "This voice channel is full (5 participants)"
  // "Join this voice channel first"
  // "That peer is not in this voice channel"
  // "Unauthorized"  → o socket também será desconectado
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
seja `VOICE`). Não há push de presença para quem está fora do canal ainda — se
quiser a lista viva, faça polling ou espere a decisão sobre presença
server-wide (ver "Open decisions" no doc de design).

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
- **`topology` sempre vem `'mesh'`.** O campo existe para a Fase 2; se um dia
  vier `'sfu'`, o cliente antigo precisa falhar explicitamente em vez de assumir
  mesh.

## Roteiro de teste

1. Duas abas, contas diferentes, mesmo canal `VOICE` — áudio flui nos dois
   sentidos.
2. Mute numa aba → ícone muda na outra (`voice:state-changed`).
3. Fecha uma aba → a outra recebe `voice:peer-left` em ~1s.
4. Terceira aba com a **mesma** conta da primeira → a primeira recebe
   `voice:evicted` e cai.
5. Canal `TEXT` → `error` com "This channel is not a voice channel".
6. 6º participante → `error` com "This voice channel is full (5 participants)".
7. `iceTransportPolicy: 'relay'` → ainda conecta (prova o TURN).

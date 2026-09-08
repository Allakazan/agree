import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsObject, IsString } from 'class-validator';
import { IsObjectID } from 'src/common/decorators/isObjectID';

export enum VoiceSignalKind {
  OFFER = 'offer',
  ANSWER = 'answer',
  CANDIDATE = 'candidate',
}

/**
 * One WebRTC handshake step, relayed verbatim between two peers already in the
 * same voice room.
 *
 * **Glare avoidance:** the *newcomer* offers to every existing participant, and
 * existing participants only ever answer. That convention is a client-side
 * rule — the server relays whatever it is handed — but it is what keeps a
 * simultaneous-offer race, and the rollback logic that would resolve it, out of
 * the protocol entirely.
 */
export class VoiceSignalDto {
  @IsString()
  @IsObjectID()
  @ApiProperty()
  channelId: string;

  /** The peer this step is for; a user id, since that is what peers know. */
  @IsString()
  @IsObjectID()
  @ApiProperty()
  targetUserId: string;

  @IsEnum(VoiceSignalKind)
  @ApiProperty({ enum: VoiceSignalKind })
  kind: VoiceSignalKind;

  /**
   * An `RTCSessionDescriptionInit` or `RTCIceCandidateInit`, opaque to us. The
   * server never parses SDP; it only checks that both ends are in the room.
   * Size is bounded by socket.io's own `maxHttpBufferSize` (1 MB by default),
   * which is far above any legitimate SDP.
   */
  @IsObject()
  @ApiProperty({ type: Object })
  payload: Record<string, unknown>;
}

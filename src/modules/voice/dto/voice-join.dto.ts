import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { IsObjectID } from 'src/common/decorators/isObjectID';

/**
 * `voice:join` and `voice:leave` carry the same payload — the channel being
 * entered or left — the way `subscribe`/`unsubscribe` share
 * `ChannelSubscriptionDto` in chat.
 *
 * `channelId` is a Mongo ObjectID string: channels live in Mongo, voice
 * presence lives in this process, and nothing but this validator stands between
 * the two. There is no foreign key to catch a malformed one.
 */
export class VoiceJoinDto {
  @IsString()
  @IsObjectID()
  @ApiProperty()
  channelId: string;
}

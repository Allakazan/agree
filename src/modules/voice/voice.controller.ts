import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { User } from 'src/modules/auth/decorators/user.decorator';
import { LoggedUser } from 'src/modules/auth/types/loggedUser.type';
import { ChannelType } from '../server/schemas/channel.schema';
import { ServerService } from '../server/server.service';
import {
  VOICE_PRESENCE_STORE,
  VoicePresenceStore,
} from './voice.presence.interface';
import { VoiceTopologyService } from './voice.topology.service';

@Controller('voice')
@ApiBearerAuth()
export class VoiceController {
  constructor(
    private readonly serverService: ServerService,
    private readonly topologyService: VoiceTopologyService,
    @Inject(VOICE_PRESENCE_STORE)
    private readonly presence: VoicePresenceStore,
  ) {}

  /**
   * Who is currently in a voice channel — what a client needs to render the
   * channel list before anyone clicks into a call.
   *
   * This carries its own membership gate. The gateway's rule ("presence in the
   * room is the authorization") says nothing about a REST caller, which has no
   * room: every entry point checks for itself.
   */
  @Get('/:channelId/participants')
  async findParticipants(
    @Param('channelId') channelId: string,
    @User() user: LoggedUser,
  ) {
    const channel = await this.serverService.findChannelForMember(
      user.sub,
      channelId,
    );

    if (!channel) {
      throw new BadRequestException(
        "You are not a member of this channel's server",
      );
    }

    if (channel.type !== ChannelType.VOICE) {
      throw new BadRequestException('This channel is not a voice channel');
    }

    return {
      channelId,
      topology: this.topologyService.current(channelId),
      participants: await this.presence.listByChannel(channelId),
    };
  }
}

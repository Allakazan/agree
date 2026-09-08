import { Module } from '@nestjs/common';
import { AuthGuard } from 'src/modules/auth/guards/auth.guard';
import { AuthModule } from '../auth/auth.module';
import { ServerModule } from '../server/server.module';
import { VoiceController } from './voice.controller';
import { VoiceGateway } from './voice.gateway';
import { VoiceIceService } from './voice.ice.service';
import { VOICE_PRESENCE_STORE } from './voice.presence.interface';
import { InMemoryVoicePresenceService } from './voice.presence.service';
import { VoiceTopologyService } from './voice.topology.service';

@Module({
  // AuthModule for WsAuthService (handshake auth), ServerModule for the
  // membership gate on join.
  imports: [AuthModule, ServerModule],
  controllers: [VoiceController],
  providers: [
    VoiceGateway,
    VoiceTopologyService,
    VoiceIceService,
    // The Redis seam: presence is behind its interface, so swapping the store
    // out later is this one line plus a new implementation, not a refactor.
    { provide: VOICE_PRESENCE_STORE, useClass: InMemoryVoicePresenceService },
    // Re-provided locally: the global APP_GUARD registration does not reach WS
    // handlers, and AuthModule does not export the guard.
    AuthGuard,
  ],
})
export class VoiceModule {}

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { throttlerOptions } from './common/throttle';

// Modules
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ServerModule } from './modules/server/server.module';
import { ChatModule } from './modules/chat/chat.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { VoiceModule } from './modules/voice/voice.module';

// Config
import database from './config/database';
import auth from './config/auth';
import voice from './config/voice';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [database, auth, voice],
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('database.mongodb.url'),
      }),
    }),
    ThrottlerModule.forRoot(throttlerOptions),
    ServerModule,
    ChatModule,
    AuthModule,
    UsersModule,
    VoiceModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // HTTP only — see `src/common/throttle.ts` for why gateways are exempt.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}

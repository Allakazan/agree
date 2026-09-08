import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';

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
    ServerModule,
    ChatModule,
    AuthModule,
    UsersModule,
    VoiceModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { httpCorsOptions } from './common/cors';
import { envInt } from './common/env';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Quantos proxies confiáveis ficam na frente da app. O rate limit
  // (`src/common/throttle.ts`) identifica o cliente por `req.ip`; sem isto ele
  // seria o IP do proxy do Cloud Run, e todo usuário cairia no mesmo balde.
  // Um número, não `true`: o Express pega a entrada do `X-Forwarded-For` a N
  // saltos da direita — as da esquerda o próprio cliente pode forjar.
  app.set('trust proxy', envInt(process.env.TRUST_PROXY_HOPS, 1));

  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  // Habilita CORS — mesma lista de origens usada pelos gateways WS, que agora
  // compartilham esta porta (`src/common/cors.ts`, configurável via `ORIGIN`).
  app.enableCors(httpCorsOptions);

  const config = new DocumentBuilder()
    .setTitle('Agree Backend')
    .setDescription('Agree main backend service')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, documentFactory);

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();

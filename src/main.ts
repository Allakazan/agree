import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { httpCorsOptions } from './common/cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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

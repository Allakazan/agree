import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  // Habilita CORS
  app.enableCors({
    origin: '*', // Change when production
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true, // se for usar cookies/autenticação
  });

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

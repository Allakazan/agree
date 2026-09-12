import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { AppController } from '../app.controller';
import { AppService } from '../app.service';
import { AuthController } from '../modules/auth/auth.controller';
import { AuthService } from '../modules/auth/auth.service';
import { UsersService } from '../modules/users/users.service';
import { loginThrottle, throttlerOptions } from './throttle';

/**
 * Wires the real controllers to the real limits, the same way `AppModule`
 * does, and checks what each route actually answers. `AuthGuard` is left out:
 * it's a separate global guard, and the routes exercised here are public.
 */
describe('HTTP rate limiting', () => {
  let app: INestApplication<App>;

  const defaultLimit = throttlerOptions.throttlers[0].limit;
  const loginLimit = loginThrottle.default.limit;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(throttlerOptions)],
      controllers: [AppController, AuthController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: AppService, useValue: { getHello: () => 'Hello World!' } },
        {
          provide: AuthService,
          useValue: { signIn: () => Promise.resolve({ access_token: 'jwt' }) },
        },
        { provide: UsersService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const login = () =>
    request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: 'bruno', password: 'wrong' });

  it('blocks POST /auth/login after the stricter login limit, with Retry-After', async () => {
    for (let i = 0; i < loginLimit; i++) {
      await login().expect(200);
    }

    const blocked = await login().expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('gives each route its own bucket, so a blocked login leaves other routes alone', async () => {
    for (let i = 0; i <= loginLimit; i++) await login();

    await request(app.getHttpServer()).get('/').expect(200);
  });

  it('applies the default limit to routes without an override', async () => {
    for (let i = 0; i < defaultLimit; i++) {
      await request(app.getHttpServer()).get('/').expect(200);
    }

    await request(app.getHttpServer()).get('/').expect(429);
  });

  it('never throttles /health', async () => {
    for (let i = 0; i < defaultLimit + 5; i++) {
      await request(app.getHttpServer()).get('/health').expect(200);
    }
  });
});

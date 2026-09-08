import 'dotenv/config';

import mongoose from 'mongoose';
import { faker } from '@faker-js/faker';
import * as argon2 from 'argon2';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { ServerSchema } from './modules/server/schemas/server.schema';
import { ChannelType } from './modules/server/schemas/channel.schema';
import { UserSchema } from './modules/users/schemas/user.schema';
import { conversations, messages } from './drizzle/schema';

const DEFAUT_USER = {
  username: 'admin',
  email: 'admin@example.com',
  password: 'admin123',
};

// Reused for every seeded (non-admin) user — a real, memorable login instead
// of an unusable random password, so any of them can be used to test DMs
// from a second account.
const SEED_USER_PASSWORD = 'password123';

// Volume knobs for the stress/pagination test this seed is for.
const SERVER_COUNT = 20;
const USER_COUNT = 150;
const CHANNELS_PER_SERVER = { min: 4, max: 8 };
const MESSAGES_PER_CHANNEL = { min: 300, max: 1000 };
const ADMIN_DM_COUNT = 40;
const RANDOM_DM_COUNT = 100;
const MESSAGES_PER_DM = { min: 20, max: 300 };
const MESSAGE_TIMESPAN_DAYS = 90;
const INSERT_BATCH_SIZE = 500;

const Server = mongoose.model('Server', ServerSchema);
const User = mongoose.model('User', UserSchema);

type SeededUser = {
  _id: mongoose.Types.ObjectId;
  username: string;
  profileImageUrl: string;
};

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    chunks.push(items.slice(i, i + size));
  return chunks;
}

/** `count` random timestamps within the last `MESSAGE_TIMESPAN_DAYS`, oldest first. */
function messageTimestamps(count: number): Date[] {
  const now = Date.now();
  const spanMs = MESSAGE_TIMESPAN_DAYS * 24 * 60 * 60 * 1000;
  return Array.from({ length: count }, () => now - Math.random() * spanMs)
    .sort((a, b) => a - b)
    .map((ms) => new Date(ms));
}

/** Inserts one `conversations` row plus `count` random messages between `senders`, in batches. */
async function seedConversation(
  db: ReturnType<typeof drizzle>,
  conversationValues: typeof conversations.$inferInsert,
  count: number,
  senders: SeededUser[],
) {
  const timestamps = messageTimestamps(count);
  const [conversation] = await db
    .insert(conversations)
    .values({
      ...conversationValues,
      lastMessageAt: timestamps[timestamps.length - 1],
    })
    .returning({ id: conversations.id });

  const rows = timestamps.map((createdAt) => {
    const sender = faker.helpers.arrayElement(senders);
    return {
      conversationId: conversation.id,
      senderId: String(sender._id),
      senderUsername: sender.username,
      senderAvatarUrl: sender.profileImageUrl,
      content: faker.lorem.sentence({ min: 3, max: 20 }),
      createdAt,
    };
  });

  for (const batch of chunk(rows, INSERT_BATCH_SIZE)) {
    await db.insert(messages).values(batch);
  }
}

async function seed() {
  console.log('🌱 Conectando ao MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI!);

  console.log('🌱 Conectando ao Postgres...');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  console.log('🗑️  Limpando dados existentes...');
  await db.execute(
    sql`TRUNCATE TABLE messages, conversations RESTART IDENTITY CASCADE`,
  );
  await Server.deleteMany({});
  await User.deleteMany({});

  // 1. Servers + channels
  const serversData = Array.from({ length: SERVER_COUNT }).map(() => ({
    name: faker.company.name(),
    description: faker.commerce.productDescription(),
    logoImg: faker.image.avatar(),
    bannerImage: faker.image.urlLoremFlickr({ category: 'abstract' }),
    channels: [
      { name: 'geral', type: ChannelType.TEXT },
      { name: 'random', type: ChannelType.TEXT },
      { name: 'voice-chat', type: ChannelType.VOICE },
      ...Array.from({
        length: faker.number.int(CHANNELS_PER_SERVER) - 2,
      }).map(() => ({
        name: faker.word.noun(),
        type: faker.helpers.arrayElement(Object.values(ChannelType)),
      })),
    ],
  }));
  const servers = await Server.insertMany(serversData);
  console.log(`✅ ${servers.length} servidores criados`);

  // 2. Users — the fixed `admin` is a member of every server, so it always
  // has data to browse; the rest get a random subset (server membership
  // gates who `ChatGateway` lets subscribe to a channel).
  const sharedPasswordHash = await argon2.hash(SEED_USER_PASSWORD);
  const randomUsersData = Array.from({ length: USER_COUNT }).map(() => ({
    username: faker.internet.username(),
    email: faker.internet.email(),
    password: sharedPasswordHash,
    profileImageUrl: faker.image.avatar(),
    serverIds: faker.helpers.arrayElements(
      servers.map((s) => s._id),
      { min: 1, max: 5 },
    ),
  }));
  const adminData = {
    ...DEFAUT_USER,
    password: await argon2.hash(DEFAUT_USER.password),
    profileImageUrl: faker.image.avatar(),
    serverIds: servers.map((s) => s._id),
  };
  const users = (await User.insertMany([
    ...randomUsersData,
    adminData,
  ])) as unknown as SeededUser[];
  const admin = users.find((u) => u.username === DEFAUT_USER.username)!;
  console.log(
    `✅ ${users.length} usuários criados (senha padrão: "${SEED_USER_PASSWORD}", exceto admin)`,
  );

  // 3. Channel messages — one `conversations` row per channel, seeded with
  // messages from that server's members (falls back to `admin` if a server
  // somehow has none, which can't happen since admin is in every server).
  console.log('💬 Populando mensagens de canal...');
  let channelCount = 0;
  for (const server of servers) {
    const members = users.filter((u) =>
      (u as unknown as { serverIds: mongoose.Types.ObjectId[] }).serverIds.some(
        (id) => id.equals(server._id),
      ),
    );
    const channels = server.channels as unknown as {
      _id: mongoose.Types.ObjectId;
    }[];
    for (const channel of channels) {
      const count = faker.number.int(MESSAGES_PER_CHANNEL);
      await seedConversation(
        db,
        { type: 'channel', relatedMongoChannelId: String(channel._id) },
        count,
        members,
      );
      channelCount += 1;
      if (channelCount % 20 === 0)
        console.log(`   …${channelCount} canais populados`);
    }
  }
  console.log(`✅ ${channelCount} canais populados com mensagens`);

  // 4. DMs — plenty tied to `admin` (so its own conversation list has
  // something to paginate) plus a scatter of DMs between random other users.
  console.log('💬 Populando conversas diretas...');
  const otherUsers = users.filter((u) => u.username !== DEFAUT_USER.username);

  // `dm_key` is unique per pair — track what's taken so a repeat draw skips
  // instead of hitting a constraint violation.
  const usedDmKeys = new Set<string>();
  function reserveDmKey(a: SeededUser, b: SeededUser): string | null {
    const participants = [String(a._id), String(b._id)].sort();
    const dmKey = participants.join(':');
    if (usedDmKeys.has(dmKey)) return null;
    usedDmKeys.add(dmKey);
    return dmKey;
  }

  let dmCount = 0;
  for (let i = 0; i < ADMIN_DM_COUNT; i++) {
    const peer = faker.helpers.arrayElement(otherUsers);
    const dmKey = reserveDmKey(admin, peer);
    if (!dmKey) continue;
    await seedConversation(
      db,
      { type: 'dm', participants: dmKey.split(':'), dmKey },
      faker.number.int(MESSAGES_PER_DM),
      [admin, peer],
    );
    dmCount += 1;
  }

  for (let i = 0; i < RANDOM_DM_COUNT; i++) {
    const [a, b] = faker.helpers.arrayElements(otherUsers, 2);
    const dmKey = reserveDmKey(a, b);
    if (!dmKey) continue;
    await seedConversation(
      db,
      { type: 'dm', participants: dmKey.split(':'), dmKey },
      faker.number.int(MESSAGES_PER_DM),
      [a, b],
    );
    dmCount += 1;
  }
  console.log(`✅ ${dmCount} conversas diretas populadas`);

  console.log('🌱 Seeding completo!');
  console.log('🔐 Login padrão:');
  console.log(`   Usuário: ${DEFAUT_USER.username}`);
  console.log(`   Senha: ${DEFAUT_USER.password}`);

  await pool.end();
}

seed()
  .catch((err) => {
    console.error('💥 Erro ao rodar seed:', err);
  })
  .finally(() => {
    void mongoose.disconnect();
  });

import 'dotenv/config';

import mongoose from 'mongoose';
import { faker } from '@faker-js/faker';
import * as argon2 from 'argon2';
import { ServerSchema } from './modules/server/schemas/server.schema';
import { UserSchema } from './modules/users/schemas/user.schema';

const DEFAUT_USER = {
  username: 'admin',
  email: 'admin@example.com',
  password: 'admin123',
};

// Define os models manualmente
const Server = mongoose.model('Server', ServerSchema);
const User = mongoose.model('User', UserSchema);

async function seed() {
  console.log('🌱 Starting seeding process...');
  console.log('🌱 Conectando ao MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI!);

  // 1. Clear existing data
  await Server.deleteMany({});
  await User.deleteMany({});

  // 2. Create servers
  const serversData = Array.from({ length: 5 }).map(() => ({
    name: faker.company.name(),
    description: faker.commerce.productDescription(),
    logoImg: faker.image.avatar(),
    bannerImage: faker.image.urlLoremFlickr({ category: 'abstract' }),
  }));

  const servers = await Server.insertMany(serversData);
  console.log(`✅ Inserted ${servers.length} servers`);

  // 3. Create users and assign random servers
  const usersData = await Promise.all(
    Array.from({ length: 10 }).map(async () => {
      const userServers = faker.helpers.arrayElements(
        servers.map((s) => s._id),
        { min: 1, max: 3 },
      );

      return {
        username: faker.internet.username(),
        email: faker.internet.email(),
        password: await argon2.hash(faker.internet.password()),
        profileImageUrl: faker.image.avatar(),
        serverIds: userServers,
      };
    }),
  );

  // 4. Add fixed user (you can change these credentials)
  const fixedUser = {
    ...DEFAUT_USER,
    password: await argon2.hash(DEFAUT_USER.password),
    profileImageUrl: faker.image.avatar(),
    serverIds: faker.helpers.arrayElements(
      servers.map((s) => s._id),
      { min: 2, max: 4 },
    ),
  };

  usersData.push(fixedUser);

  const users = await User.insertMany(usersData);

  console.log(`✅ Inserted ${users.length} users`);

  console.log('🌱 Seeding completed!');
  console.log('🔐 Default login:');
  console.log(`   Email: ${DEFAUT_USER.email}`);
  console.log(`   Password: ${DEFAUT_USER.password}`);
}

seed()
  .catch((err) => {
    console.error('💥 Erro ao rodar seed:', err);
  })
  .finally(() => {
    mongoose.disconnect();
  });

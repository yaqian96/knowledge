import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'; // bcrypt hash of 'demo123'
  const user = await prisma.$executeRaw`
    INSERT INTO "User" (id, username, email, password) 
    VALUES (${require('crypto').randomUUID()}, 'demo-user', 'demo@example.com', ${hashedPassword})
    ON CONFLICT (username) DO NOTHING
  `;
  console.log('Demo user created or already exists');
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('demo123', 10);
  const userId = crypto.randomUUID();
  
  try {
    await prisma.user.create({
      data: {
        id: userId,
        username: 'demo-user',
        email: 'demo@example.com',
        password: hashedPassword,
      },
    });
    console.log('Demo user created successfully!');
    console.log('User ID:', userId);
    console.log('Username: demo-user');
    console.log('Password: demo123');
  } catch (e) {
    if (e.code === 'P2002') {
      console.log('Demo user already exists, skipping...');
    } else {
      throw e;
    }
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());

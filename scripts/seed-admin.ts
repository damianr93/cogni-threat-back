import { PrismaClient } from '@prisma/client';
import { pbkdf2Sync, randomBytes } from 'crypto';

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const iterations = 210000;
  const salt = randomBytes(16).toString('base64url');
  const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64url');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password || password.length < 8) {
    throw new Error('Configura ADMIN_EMAIL y ADMIN_PASSWORD con al menos 8 caracteres');
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash: hashPassword(password),
      role: 'ADMIN',
      permission: 'WRITE',
      isActive: true,
    },
    create: {
      email,
      passwordHash: hashPassword(password),
      role: 'ADMIN',
      permission: 'WRITE',
      isActive: true,
    },
    select: {
      id: true,
      email: true,
      role: true,
      permission: true,
    },
  });

  console.log(`Admin listo: ${user.email} (${user.role}/${user.permission})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

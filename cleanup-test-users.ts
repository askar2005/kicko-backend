import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  // Clean up test users created during debugging
  const deleted = await p.user.deleteMany({
    where: {
      email: {
        in: [
          'test_debug_xyz@test.com',
          'test_http_1784559823642@test.com',
          'test_http_1784559904341@test.com',
          'finaltest123@test.com'
        ]
      }
    }
  });
  console.log('Cleaned up', deleted.count, 'test users');
}

main().catch(console.error).finally(() => p.$disconnect());

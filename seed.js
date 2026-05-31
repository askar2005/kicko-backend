const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('password123', 10);
  const ownerId = 'owner-123';
  let owner = await prisma.turfOwner.findUnique({ where: { id: ownerId } });
  if (!owner) {
    owner = await prisma.turfOwner.create({
      data: {
        id: ownerId,
        name: 'Mock Owner',
        email: 'owner@example.com',
        phone: '1234567890',
        password: hashedPassword
      }
    });
    console.log('Created mock owner:', owner);
  } else {
    console.log('Mock owner already exists:', owner);
  }

  const adminEmail = 'admin@kicko.com';
  let admin = await prisma.admin.findUnique({ where: { email: adminEmail } });
  if (!admin) {
    admin = await prisma.admin.create({
      data: {
        name: 'Super Admin',
        email: adminEmail,
        phone: '1234567890',
        password: hashedPassword
      }
    });
    console.log('Created mock admin:', admin);
  } else {
    console.log('Mock admin already exists:', admin);
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });

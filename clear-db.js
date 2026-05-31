const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  console.log('Starting database purge...');

  // 1. Delete dependent records first to avoid foreign key constraint violations
  const deleteReviews = await prisma.review.deleteMany({});
  console.log(`Deleted ${deleteReviews.count} reviews.`);

  const deleteBookings = await prisma.booking.deleteMany({});
  console.log(`Deleted ${deleteBookings.count} bookings.`);

  const deleteTurfs = await prisma.turf.deleteMany({});
  console.log(`Deleted ${deleteTurfs.count} turfs.`);

  const deleteUsers = await prisma.user.deleteMany({});
  console.log(`Deleted ${deleteUsers.count} users.`);

  const deleteOwners = await prisma.turfOwner.deleteMany({});
  console.log(`Deleted ${deleteOwners.count} turf owners.`);

  const deleteAdmins = await prisma.admin.deleteMany({});
  console.log(`Deleted ${deleteAdmins.count} admins.`);

  console.log('Database successfully purged. Seeding clean default admin account...');

  // 2. Seed clean Super Admin account
  const hashedPassword = await bcrypt.hash('password123', 10);
  const admin = await prisma.admin.create({
    data: {
      name: 'Super Admin',
      email: 'admin@kicko.com',
      phone: '1234567890',
      password: hashedPassword
    }
  });
  console.log('Seeded default admin:', admin.email);

  // 3. Seed clean default Turf Owner account (optional, for owner login testing)
  const owner = await prisma.turfOwner.create({
    data: {
      id: 'owner-123',
      name: 'Default Owner',
      email: 'owner@example.com',
      phone: '1234567890',
      password: hashedPassword
    }
  });
  console.log('Seeded default owner:', owner.email);

  console.log('Database cleanup and re-seeding completed successfully.');
}

main()
  .catch(e => {
    console.error('Error cleaning database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

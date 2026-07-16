-- Additive repair for Neon databases that were created before the current
-- owner/admin/booking workflow fields existed in Prisma migrations.

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "password" TEXT NOT NULL DEFAULT '1234';

ALTER TABLE "TurfOwner"
ADD COLUMN IF NOT EXISTS "password" TEXT NOT NULL DEFAULT '1234';

ALTER TABLE "Turf"
ADD COLUMN IF NOT EXISTS "city" TEXT,
ADD COLUMN IF NOT EXISTS "area" TEXT,
ADD COLUMN IF NOT EXISTS "sportType" TEXT,
ADD COLUMN IF NOT EXISTS "capacity" TEXT,
ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "amenities" TEXT,
ADD COLUMN IF NOT EXISTS "images" TEXT,
ADD COLUMN IF NOT EXISTS "slotPrices" TEXT,
ADD COLUMN IF NOT EXISTS "activeSlots" TEXT,
ADD COLUMN IF NOT EXISTS "blockedSlots" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN IF NOT EXISTS "ownerBookedSlots" TEXT NOT NULL DEFAULT '[]';

ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "paymentOrderId" TEXT,
ADD COLUMN IF NOT EXISTS "paymentId" TEXT,
ADD COLUMN IF NOT EXISTS "paymentStatus" TEXT;

CREATE TABLE IF NOT EXISTS "Admin" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Admin_email_key" ON "Admin"("email");

CREATE TABLE IF NOT EXISTS "Review" (
    "id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "turfId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Review_userId_turfId_key" ON "Review"("userId", "turfId");
CREATE UNIQUE INDEX IF NOT EXISTS "Booking_turfId_date_startTime_endTime_key"
ON "Booking"("turfId", "date", "startTime", "endTime");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Review_userId_fkey') THEN
        ALTER TABLE "Review"
        ADD CONSTRAINT "Review_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Review_turfId_fkey') THEN
        ALTER TABLE "Review"
        ADD CONSTRAINT "Review_turfId_fkey"
        FOREIGN KEY ("turfId") REFERENCES "Turf"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

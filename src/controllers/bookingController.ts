import { Request, Response, Router } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();
const prisma = new PrismaClient();

export type BookingPayload = {
  userId: string;
  turfId: string;
  date: string;
  startTime: string;
  endTime: string;
  paymentOrderId?: string;
  paymentId?: string;
  paymentStatus?: string;
};

export const normalizeSlotLabel = (slot: string) =>
  slot.replace(/\s*[-\u2013\u2014]\s*/, ' - ').trim();

export const DEFAULT_SLOT_TIMES = [
  '06:00 - 07:00',
  '07:00 - 08:00',
  '08:00 - 09:00',
  '09:00 - 10:00',
  '10:00 - 11:00',
  '11:00 - 12:00',
  '12:00 - 13:00',
  '13:00 - 14:00',
  '14:00 - 15:00',
  '15:00 - 16:00',
  '16:00 - 17:00',
  '17:00 - 18:00',
  '18:00 - 19:00',
  '19:00 - 20:00',
  '20:00 - 21:00',
  '21:00 - 22:00',
  '22:00 - 23:00',
  '23:00 - 00:00',
];

export const parseSlotList = (value: unknown): string[] => {
  if (!value) return [];

  try {
    const raw = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((slot) => normalizeSlotLabel(String(slot)))
      .filter((slot) => slot.length > 0);
  } catch {
    return [];
  }
};

type BlockedSlotEntry = {
  slot: string;
  date?: string;
};

const normalizeDateValue = (value?: string) => String(value || '').trim();

const isBlockedEntryActiveForDate = (entry: BlockedSlotEntry, date?: string) => {
  if (!entry.date) return false;
  if (!date) return true;
  return normalizeDateValue(entry.date) === normalizeDateValue(date);
};

export const cleanupLegacyBlockedSlots = async (
  client: PrismaClient | Prisma.TransactionClient,
  turfId: string
) => {
  const turf = await client.turf.findUnique({
    where: { id: turfId },
    select: { blockedSlots: true }
  });

  if (!turf) {
    return [];
  }

  const parsed = parseBlockedSlotEntries(turf.blockedSlots);
  const cleaned = parsed.filter((entry) => String(entry.date || '').trim());

  if (cleaned.length !== parsed.length) {
    await client.turf.update({
      where: { id: turfId },
      data: {
        blockedSlots: JSON.stringify(cleaned)
      }
    });
  }

  return cleaned;
};

export const parseBlockedSlotEntries = (value: unknown): BlockedSlotEntry[] => {
  if (!value) return [];

  try {
    const raw = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(raw)) return [];

    return raw
      .map((item) => {
        if (typeof item === 'string') {
          return { slot: normalizeSlotLabel(item) } as BlockedSlotEntry;
        }

        return {
          slot: normalizeSlotLabel(String(item?.slot || '')),
          date: String(item?.date || '').trim() || undefined
        };
      })
      .filter((item) => item.slot);
  } catch {
    return [];
  }
};

type OwnerBookedSlot = {
  slot: string;
  date: string;
  releaseAt: string;
};

export const parseOwnerBookedSlots = (value: unknown): OwnerBookedSlot[] => {
  if (!value) return [];

  try {
    const raw = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(raw)) return [];

    return raw
      .map((item) => ({
        slot: normalizeSlotLabel(String(item?.slot || '')),
        date: String(item?.date || '').trim(),
        releaseAt: String(item?.releaseAt || '').trim(),
      }))
      .filter((item) => item.slot && item.date && item.releaseAt);
  } catch {
    return [];
  }
};

export const cleanupExpiredOwnerBookedSlots = async (
  client: PrismaClient | Prisma.TransactionClient,
  turfId: string
) => {
  const turf = await client.turf.findUnique({
    where: { id: turfId },
    select: { ownerBookedSlots: true }
  });

  if (!turf) {
    return [];
  }

  const now = new Date();
  const activeHolds = parseOwnerBookedSlots(turf.ownerBookedSlots).filter((hold) => {
    const releaseAt = new Date(hold.releaseAt);
    return Number.isFinite(releaseAt.getTime()) && releaseAt > now;
  });

  const stored = parseOwnerBookedSlots(turf.ownerBookedSlots);
  if (stored.length !== activeHolds.length) {
    await client.turf.update({
      where: { id: turfId },
      data: {
        ownerBookedSlots: JSON.stringify(activeHolds)
      }
    });
  }

  return activeHolds;
};

export type TurfSlotState = 'OPEN' | 'BOOKED' | 'OWNER_BOOKED' | 'BLOCKED';

export type TurfSlotSnapshot = {
  turfId: string;
  activeSlots: string[];
  blockedSlots: string[];
  blockedSlotEntries: BlockedSlotEntry[];
  bookedSlots: string[];
  ownerBookedSlots: OwnerBookedSlot[];
  slotStates: Array<{
    slot: string;
    state: TurfSlotState;
    releaseAt?: string;
  }>;
};

export const getTurfSlotSnapshot = async (
  client: PrismaClient | Prisma.TransactionClient,
  turfId: string,
  date?: string
): Promise<TurfSlotSnapshot> => {
  const turf = await client.turf.findUnique({
    where: { id: turfId },
    select: {
      id: true,
      activeSlots: true,
      blockedSlots: true,
      ownerBookedSlots: true,
    }
  });

  if (!turf) {
    throw new Error('Turf not found');
  }

  const cleanedOwnerBookedSlots = await cleanupExpiredOwnerBookedSlots(client, turfId);
  const activeSlots = parseSlotList(turf.activeSlots);
  const approvedSlots = activeSlots.length > 0 ? activeSlots : DEFAULT_SLOT_TIMES;
  const blockedSlotEntries = await cleanupLegacyBlockedSlots(client, turfId);
  const blockedSlots = blockedSlotEntries
    .filter((entry) => isBlockedEntryActiveForDate(entry, date))
    .map((entry) => entry.slot);

  const bookings = date
    ? await client.booking.findMany({
        where: {
          turfId,
          date,
          status: 'CONFIRMED'
        },
        select: {
          startTime: true,
          endTime: true
        }
      })
    : [];

  const bookedSlots = bookings.map((booking) => normalizeSlotLabel(`${booking.startTime} - ${booking.endTime}`));
  const bookedSet = new Set(bookedSlots);
  const blockedSet = new Set(blockedSlots);
  const ownerBookedForDate = cleanedOwnerBookedSlots.filter((hold) => !date || hold.date === date);
  const ownerBookedSet = new Set(ownerBookedForDate.map((hold) => hold.slot));

  const slotStates = approvedSlots.map((slot) => {
    const normalizedSlot = normalizeSlotLabel(slot);
    const hold = ownerBookedForDate.find((item) => item.slot === normalizedSlot);

    if (bookedSet.has(normalizedSlot)) {
      return { slot: normalizedSlot, state: 'BOOKED' as const };
    }

    if (blockedSet.has(normalizedSlot)) {
      return { slot: normalizedSlot, state: 'BLOCKED' as const };
    }

    if (ownerBookedSet.has(normalizedSlot)) {
      return {
        slot: normalizedSlot,
        state: 'OWNER_BOOKED' as const,
        releaseAt: hold?.releaseAt,
      };
    }

    return { slot: normalizedSlot, state: 'OPEN' as const };
  });

  return {
    turfId,
    activeSlots: approvedSlots,
    blockedSlots,
    blockedSlotEntries,
    bookedSlots,
    ownerBookedSlots: cleanedOwnerBookedSlots,
    slotStates
  };
};

export const ensureSlotsAreBookable = async (
  client: PrismaClient | Prisma.TransactionClient,
  turfId: string,
  slots: string[],
  date?: string
) => {
  const snapshot = await getTurfSlotSnapshot(client, turfId, date);
  const activeSlotSet = new Set(snapshot.activeSlots);
  const stateMap = new Map(snapshot.slotStates.map((slot) => [slot.slot, slot]));

  for (const slot of slots) {
    const normalizedSlot = normalizeSlotLabel(slot);

    if (snapshot.activeSlots.length > 0 && !activeSlotSet.has(normalizedSlot)) {
      throw new Error(`Slot ${normalizedSlot} is not approved for this turf`);
    }

    const currentState = stateMap.get(normalizedSlot)?.state;
    if (currentState === 'BLOCKED') {
      throw new Error(`Slot ${normalizedSlot} is blocked by the owner`);
    }

    if (currentState === 'OWNER_BOOKED') {
      throw new Error(`Slot ${normalizedSlot} is already marked booked by the owner`);
    }

    if (currentState === 'BOOKED') {
      throw new Error(`Slot ${normalizedSlot} is already booked`);
    }
  }

  return snapshot;
};

export const createBookingRecord = async (
  client: PrismaClient | Prisma.TransactionClient,
  bookingData: BookingPayload
) => {
  const requestedSlot = normalizeSlotLabel(`${bookingData.startTime} - ${bookingData.endTime}`);

  await ensureSlotsAreBookable(client, bookingData.turfId, [requestedSlot], bookingData.date);

  try {
    return await client.booking.create({
      data: {
        userId: bookingData.userId,
        turfId: bookingData.turfId,
        date: bookingData.date,
        startTime: bookingData.startTime,
        endTime: bookingData.endTime,
        status: 'CONFIRMED',
        paymentOrderId: bookingData.paymentOrderId,
        paymentId: bookingData.paymentId,
        paymentStatus: bookingData.paymentStatus
      }
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      throw new Error('Slot already booked or overlaps with an existing booking');
    }
    throw error;
  }
};

// Create a new booking
router.post('/', authenticateToken, async (req: Request, res: Response): Promise<any> => {
  const { turfId, date, startTime, endTime } = req.body;
  const userId = (req as any).user.id;

  try {
    const userExists = await prisma.user.findUnique({ where: { id: userId } });
    if (!userExists) {
      return res.status(401).json({ error: 'User not found. Please log in again to book a turf.' });
    }

    const booking = await prisma.$transaction(async (tx) => {
      return createBookingRecord(tx, {
        userId,
        turfId,
        date,
        startTime,
        endTime
      });
    });

    res.status(201).json(booking);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to create booking' });
  }
});

// Get all bookings for a user
router.get('/user/:userId', authenticateToken, async (req: Request, res: Response): Promise<any> => {
  try {
    const reqUserId = req.params.userId;
    const authUser = (req as any).user;

    if (authUser.id !== reqUserId && authUser.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized access to user bookings.' });
    }
    const bookings = await prisma.booking.findMany({
      where: { userId: String(req.params.userId) },
      include: { turf: true }
    });
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// Get all bookings for a turf on a specific date
router.get('/turf/:turfId', authenticateToken, async (req: Request, res: Response): Promise<any> => {
  try {
    const authUser = (req as any).user;

    if (authUser.role !== 'owner' && authUser.role !== 'admin' && authUser.role !== 'customer') {
      return res.status(403).json({ error: 'Unauthorized access to turf bookings.' });
    }

    if (authUser.role === 'owner') {
      const turf = await prisma.turf.findUnique({ where: { id: String(req.params.turfId) } });
      if (!turf || turf.ownerId !== authUser.id) {
        return res.status(403).json({ error: 'You do not own this turf.' });
      }
    }
    const { date } = req.query;
    const whereClause: any = { turfId: req.params.turfId };
    if (date) {
      whereClause.date = String(date);
    }

    const bookings = await prisma.booking.findMany({
      where: whereClause,
      include: authUser.role === 'customer' 
        ? undefined 
        : { user: { select: { id: true, name: true } } }
    });
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// Get a specific booking by ID
router.get('/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: String(req.params.id) },
      include: { turf: true, user: true }
    });
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    res.json(booking);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch booking' });
  }
});

export default router;

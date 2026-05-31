import { Request, Response, Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, requireRole } from '../middlewares/authMiddleware';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import {
  getTurfSlotSnapshot,
  normalizeSlotLabel,
  parseBlockedSlotEntries,
  parseSlotList
} from './bookingController';

const router = Router();
const prisma = new PrismaClient();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// Create a new turf (by Owner)
router.post('/', authenticateToken, requireRole(['owner']), upload.array('images', 10), async (req: Request, res: Response): Promise<any> => {
  const { name, location, pricePerHour, city, area, sportType, capacity, latitude, longitude, amenities, slotPrices, activeSlots } = req.body;
  const ownerId = (req as any).user.id;

  try {
    const ownerExists = await prisma.turfOwner.findUnique({ where: { id: ownerId } });
    if (!ownerExists) {
      return res.status(404).json({ error: 'Owner account not found in database. Please log in again.' });
    }

    const files = (req as any).files as any[] || [];
    const images = files.map(file => `/uploads/${file.filename}`);

    const turf = await prisma.turf.create({
      data: {
        ownerId,
        name,
        location,
        pricePerHour: pricePerHour ? parseFloat(pricePerHour) : 0,
        city: city || null,
        area: area || null,
        sportType: sportType || null,
        capacity: capacity || null,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        amenities: amenities || null,
        images: JSON.stringify(images),
        slotPrices: slotPrices || '{}',
        activeSlots: activeSlots || '[]',
        blockedSlots: '[]',
        ownerBookedSlots: '[]'
      }
    });
    res.status(201).json(turf);
  } catch (error) {
    console.error("Create turf error:", error);
    res.status(500).json({ error: 'Failed to create turf' });
  }
});

// Get all turfs
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, ownerId } = req.query;
    const whereClause: any = {};
    if (status) {
      // Support uppercase status comparing
      whereClause.status = String(status).toUpperCase();
    }
    if (ownerId) {
      whereClause.ownerId = String(ownerId);
    }
    const turfs = await prisma.turf.findMany({
      where: whereClause,
      include: { reviews: true }
    });
    res.json(turfs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch turfs' });
  }
});

// Get public slot availability for a turf
router.get('/:id/availability', async (req: Request, res: Response): Promise<any> => {
  try {
    const { date } = req.query;
    const snapshot = await getTurfSlotSnapshot(prisma, String(req.params.id), date ? String(date) : undefined);

    res.json({
      activeSlots: snapshot.activeSlots,
      blockedSlots: snapshot.blockedSlots,
      blockedSlotEntries: snapshot.blockedSlotEntries,
      bookedSlots: snapshot.bookedSlots,
      ownerBookedSlots: snapshot.ownerBookedSlots,
      slotStates: snapshot.slotStates
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch turf availability' });
  }
});

// Get single turf
router.get('/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const turf = await prisma.turf.findUnique({
      where: { id: String(req.params.id) },
      include: { reviews: true }
    });
    if (!turf) {
      return res.status(404).json({ error: 'Turf not found' });
    }
    res.json(turf);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch turf' });
  }
});

// Update blocked slots (Owner)
router.put('/:id/blocked-slots', authenticateToken, requireRole(['owner']), async (req: Request, res: Response): Promise<any> => {
  try {
    const { blockedSlots, date } = req.body;
    const authUser = (req as any).user;

    if (!Array.isArray(blockedSlots)) {
      return res.status(400).json({ error: 'blockedSlots must be an array' });
    }

    const normalizedDate = String(date || '').trim();
    if (!normalizedDate) {
      return res.status(400).json({ error: 'date is required to update blocked slots' });
    }

    const turf = await prisma.turf.findUnique({
      where: { id: String(req.params.id) },
      select: {
        id: true,
        ownerId: true,
        activeSlots: true
      }
    });

    if (!turf) {
      return res.status(404).json({ error: 'Turf not found' });
    }

    if (turf.ownerId !== authUser.id) {
      return res.status(403).json({ error: 'You do not own this turf.' });
    }

    const activeSlots = parseSlotList(turf.activeSlots);
    const activeSet = new Set(activeSlots);
    const snapshot = await getTurfSlotSnapshot(prisma, turf.id, normalizedDate);
    const currentStates = new Map(snapshot.slotStates.map((item) => [item.slot, item.state]));
    const normalizedBlockedSlots = Array.from(
      new Set(
        blockedSlots
          .map((slot) => normalizeSlotLabel(String(slot)))
          .filter((slot) => slot.length > 0)
      )
    ).filter((slot) => activeSlots.length === 0 || activeSet.has(slot));

    const invalidRequestedSlots = normalizedBlockedSlots.filter((slot) => {
      const state = currentStates.get(slot);
      return state === 'BOOKED' || state === 'OWNER_BOOKED';
    });

    if (invalidRequestedSlots.length > 0) {
      return res.status(400).json({
        error: `Cannot block slots that are already booked: ${invalidRequestedSlots.join(', ')}`
      });
    }

    const slotPairs = normalizedBlockedSlots.map((slot) => {
      const [startTime, endTime] = slot.split(' - ').map((part) => part.trim());
      return { startTime, endTime };
    });

    const bookedConflicts = await prisma.booking.findMany({
      where: {
        turfId: turf.id,
        status: 'CONFIRMED',
        date: normalizedDate,
        OR: slotPairs.map((pair) => ({
          startTime: pair.startTime,
          endTime: pair.endTime,
        }))
      },
      select: { id: true }
    });

    if (bookedConflicts.length > 0) {
      return res.status(400).json({
        error: 'Cannot block a slot that already has customer bookings.'
      });
    }

    const ownerHoldConflicts = snapshot.ownerBookedSlots.filter((hold) =>
      hold.date === normalizedDate && normalizedBlockedSlots.includes(hold.slot)
    );

    if (ownerHoldConflicts.length > 0) {
      return res.status(400).json({
        error: 'Cannot block a slot that is currently marked as owner booked.'
      });
    }

    const existingBlockedEntries = parseBlockedSlotEntries((turf as any).blockedSlots);
    const preservedBlockedEntries = existingBlockedEntries.filter((entry) => {
      const entryDate = String(entry.date || '').trim();
      return entryDate && entryDate !== normalizedDate;
    });

    const updatedBlockedEntries = [
      ...preservedBlockedEntries,
      ...normalizedBlockedSlots.map((slot) => ({ slot, date: normalizedDate }))
    ];

    const updatedTurf = await prisma.turf.update({
      where: { id: turf.id },
      data: {
        blockedSlots: JSON.stringify(updatedBlockedEntries)
      }
    });

    const freshSnapshot = await getTurfSlotSnapshot(prisma, turf.id, normalizedDate);

    res.json({
      ...updatedTurf,
      blockedSlots: freshSnapshot.blockedSlots,
      blockedSlotEntries: updatedBlockedEntries,
      slotStates: freshSnapshot.slotStates
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update blocked slots' });
  }
});

// Manage owner temporary booked slots for offline holds
router.put('/:id/owner-booked-slot', authenticateToken, requireRole(['owner']), async (req: Request, res: Response): Promise<any> => {
  try {
    const { date, slot, status } = req.body as {
      date?: string;
      slot?: string;
      status?: 'BOOKED' | 'OPEN';
    };
    const authUser = (req as any).user;

    if (!date || !slot || !status) {
      return res.status(400).json({ error: 'date, slot, and status are required' });
    }

    const turf = await prisma.turf.findUnique({
      where: { id: String(req.params.id) },
      select: {
        id: true,
        ownerId: true,
        activeSlots: true,
        ownerBookedSlots: true
      }
    });

    if (!turf) {
      return res.status(404).json({ error: 'Turf not found' });
    }

    if (turf.ownerId !== authUser.id) {
      return res.status(403).json({ error: 'You do not own this turf.' });
    }

    const normalizedSlot = normalizeSlotLabel(slot);
    const activeSlots = parseSlotList(turf.activeSlots);
    if (activeSlots.length > 0 && !new Set(activeSlots).has(normalizedSlot)) {
      return res.status(400).json({ error: 'This slot is not available in the approved turf schedule.' });
    }

    const snapshot = await getTurfSlotSnapshot(prisma, turf.id, String(date));
    const currentState = snapshot.slotStates.find((item) => item.slot === normalizedSlot)?.state || 'OPEN';

    if (status === 'BOOKED') {
      if (currentState === 'BOOKED') {
        return res.status(400).json({ error: 'This slot is already booked by a customer.' });
      }
      if (currentState === 'BLOCKED') {
        return res.status(400).json({ error: 'Unblock this slot before marking it as OWNER_BOOKED.' });
      }
      if (currentState === 'OWNER_BOOKED') {
        return res.json({
          ...turf,
          ownerBookedSlots: snapshot.ownerBookedSlots
        });
      }
    }

    const activeOwnerBookedSlots = snapshot.ownerBookedSlots.filter((hold) => {
      return !(hold.date === String(date) && hold.slot === normalizedSlot);
    });

    if (status === 'BOOKED') {
      const slotEnd = normalizedSlot.split(' - ')[1]?.trim();
      const releaseAt = new Date(`${String(date).trim()}T${slotEnd}:00`);

      if (Number.isNaN(releaseAt.getTime()) || releaseAt.getTime() <= Date.now()) {
        return res.status(400).json({ error: 'Cannot mark a past slot as OWNER_BOOKED.' });
      }

      activeOwnerBookedSlots.push({
        slot: normalizedSlot,
        date: String(date),
        releaseAt: releaseAt.toISOString()
      });
    }

    const savedTurf = await prisma.turf.update({
      where: { id: turf.id },
      data: {
        ownerBookedSlots: JSON.stringify(activeOwnerBookedSlots)
      }
    });

    res.json({
      ...savedTurf,
      ownerBookedSlots: activeOwnerBookedSlots,
      slotStates: (await getTurfSlotSnapshot(prisma, turf.id, String(date))).slotStates
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update owner booked slot' });
  }
});

// Update turf status (for Super Admin)
router.put('/:id/status', authenticateToken, requireRole(['admin']), async (req: Request, res: Response): Promise<any> => {
  try {
    const { status } = req.body;
    if (!status || !['PENDING', 'APPROVED', 'REJECTED'].includes(status.toUpperCase())) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    const turf = await prisma.turf.update({
      where: { id: String(req.params.id) },
      data: { status: status.toUpperCase() }
    });
    res.json(turf);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update turf status' });
  }
});

// Get turf reviews
router.get('/:id/reviews', async (req: Request, res: Response) => {
  try {
    const reviews = await prisma.review.findMany({
      where: { turfId: String(req.params.id) },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// Post a review
router.post('/:id/reviews', async (req: Request, res: Response): Promise<any> => {
  try {
    const { userId, rating, comment } = req.body;
    const turfId = String(req.params.id);

    // Check if user already reviewed
    const existing = await prisma.review.findUnique({
      where: {
        userId_turfId: { userId, turfId }
      }
    });

    if (existing) {
      return res.status(400).json({ error: 'You have already reviewed this turf.' });
    }

    const review = await prisma.review.create({
      data: { rating, comment, userId, turfId }
    });
    res.status(201).json(review);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create review' });
  }
});

export default router;

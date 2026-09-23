import { Request, Response, Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middlewares/authMiddleware';

const router = Router();
const prisma = new PrismaClient();

const normalizeSlotLabel = (slot: string) =>
  slot.replace(/\s*[-\u2013\u2014]\s*/, ' - ').trim();

// ==========================================
// PUBLIC ENDPOINT
// ==========================================

// GET /api/slot-discounts/check - Fetch active discounts for a turf & date
router.get('/check', async (req: Request, res: Response): Promise<any> => {
  try {
    const { turfId, date } = req.query as { turfId?: string; date?: string };

    if (!turfId || !date) {
      return res.status(400).json({ error: 'turfId and date are required' });
    }

    const discounts = await prisma.slotDiscount.findMany({
      where: {
        turfId,
        date,
        isActive: true,
      }
    });

    res.json(discounts);
  } catch (error: any) {
    console.error('Error checking slot discounts:', error);
    res.status(500).json({ error: 'Failed to check slot discounts' });
  }
});

// ==========================================
// TURF OWNER ENDPOINTS
// ==========================================

// GET /api/slot-discounts/owner - Fetch all discounts for logged-in owner's turfs
router.get('/owner', authenticateToken, requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const ownerId = req.user?.id;
    if (!ownerId) {
      return res.status(401).json({ error: 'Owner authentication required' });
    }

    const ownerTurfs = await prisma.turf.findMany({
      where: { ownerId },
      select: { id: true }
    });

    const turfIds = ownerTurfs.map((t) => t.id);

    const discounts = await prisma.slotDiscount.findMany({
      where: { turfId: { in: turfIds } },
      include: {
        turf: {
          select: { id: true, name: true, location: true, city: true }
        }
      },
      orderBy: [{ date: 'asc' }, { slot: 'asc' }]
    });

    res.json(discounts);
  } catch (error: any) {
    console.error('Error fetching owner slot discounts:', error);
    res.status(500).json({ error: 'Failed to fetch slot discounts' });
  }
});

// POST /api/slot-discounts - Create or update slot discount(s)
router.post('/', authenticateToken, requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const ownerId = req.user?.id;
    const {
      turfId,
      date,
      slots, // single slot string OR array of slot strings
      discountPercentage,
      label,
      isActive,
    } = req.body;

    if (!turfId || !date || !slots || discountPercentage === undefined) {
      return res.status(400).json({ error: 'turfId, date, slots, and discountPercentage are required' });
    }

    const pct = Number(discountPercentage);
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
      return res.status(400).json({ error: 'Discount percentage must be between 1% and 100%' });
    }

    // Verify turf ownership
    const turf = await prisma.turf.findUnique({ where: { id: turfId } });
    if (!turf) {
      return res.status(404).json({ error: 'Turf not found' });
    }

    if (turf.ownerId !== ownerId && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized: You do not own this turf' });
    }

    const slotList: string[] = Array.isArray(slots) ? slots : [slots];
    if (slotList.length === 0) {
      return res.status(400).json({ error: 'At least one slot must be selected' });
    }

    const results = [];
    for (const rawSlot of slotList) {
      const normSlot = normalizeSlotLabel(rawSlot);
      const discount = await prisma.slotDiscount.upsert({
        where: {
          turfId_date_slot: {
            turfId,
            date,
            slot: normSlot,
          }
        },
        create: {
          turfId,
          date,
          slot: normSlot,
          discountPercentage: pct,
          label: label ? String(label).trim() : null,
          isActive: isActive !== undefined ? Boolean(isActive) : true,
        },
        update: {
          discountPercentage: pct,
          label: label !== undefined ? (label ? String(label).trim() : null) : undefined,
          isActive: isActive !== undefined ? Boolean(isActive) : true,
        }
      });
      results.push(discount);
    }

    res.status(201).json({
      message: 'Slot discount(s) saved successfully',
      discounts: results,
    });
  } catch (error: any) {
    console.error('Error creating slot discount:', error);
    res.status(500).json({ error: 'Failed to create slot discount' });
  }
});

// PUT /api/slot-discounts/:id - Update single slot discount
router.put('/:id', authenticateToken, requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const ownerId = req.user?.id;
    const id = req.params.id as string;

    const existing = await prisma.slotDiscount.findUnique({
      where: { id },
      include: { turf: true }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Slot discount not found' });
    }

    if (existing.turf.ownerId !== ownerId && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized: You do not own this discount' });
    }

    const { discountPercentage, label, isActive, date, slot } = req.body;

    if (discountPercentage !== undefined) {
      const pct = Number(discountPercentage);
      if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
        return res.status(400).json({ error: 'Discount percentage must be between 1% and 100%' });
      }
    }

    const updated = await prisma.slotDiscount.update({
      where: { id },
      data: {
        ...(discountPercentage !== undefined && { discountPercentage: Number(discountPercentage) }),
        label: label !== undefined ? (label ? String(label).trim() : null) : existing.label,
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
        ...(date && { date }),
        ...(slot && { slot: normalizeSlotLabel(slot) }),
      }
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating slot discount:', error);
    res.status(500).json({ error: 'Failed to update slot discount' });
  }
});

// PATCH /api/slot-discounts/:id/status - Toggle active/inactive
router.patch('/:id/status', authenticateToken, requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const ownerId = req.user?.id;
    const id = req.params.id as string;
    const { isActive } = req.body;

    if (isActive === undefined) {
      return res.status(400).json({ error: 'isActive is required' });
    }

    const existing = await prisma.slotDiscount.findUnique({
      where: { id },
      include: { turf: true }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Slot discount not found' });
    }

    if (existing.turf.ownerId !== ownerId && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized: You do not own this discount' });
    }

    const updated = await prisma.slotDiscount.update({
      where: { id },
      data: { isActive: Boolean(isActive) }
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error toggling slot discount status:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// DELETE /api/slot-discounts/:id - Delete discount
router.delete('/:id', authenticateToken, requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const ownerId = req.user?.id;
    const id = req.params.id as string;

    const existing = await prisma.slotDiscount.findUnique({
      where: { id },
      include: { turf: true }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Slot discount not found' });
    }

    if (existing.turf.ownerId !== ownerId && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized: You do not own this discount' });
    }

    await prisma.slotDiscount.delete({ where: { id } });
    res.json({ message: 'Slot discount deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting slot discount:', error);
    res.status(500).json({ error: 'Failed to delete slot discount' });
  }
});

export default router;

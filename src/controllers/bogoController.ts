import { Request, Response, Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, requireRole } from '../middlewares/authMiddleware';

const router = Router();
const prisma = new PrismaClient();

const normalizeDateStr = (dateVal: unknown): string => {
  if (!dateVal) return '';
  const str = String(dateVal).trim();
  // Standardize YYYY-MM-DD or DD-MM-YYYY to YYYY-MM-DD if valid
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // If DD-MM-YYYY or DD/MM/YYYY
  const parts = str.split(/[-/]/);
  if (parts.length === 3 && parts[0].length === 2 && parts[2].length === 4) {
    const [day, month, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return str;
};

// Check if active BOGO offer exists for a turf and date (Public for Customer App)
router.get('/check', async (req: Request, res: Response): Promise<any> => {
  try {
    const { turfId, date } = req.query;

    if (!turfId || !date) {
      return res.status(400).json({ hasBogo: false, error: 'turfId and date are required' });
    }

    const normalizedDate = normalizeDateStr(date);
    const offer = await prisma.bOGOOffer.findFirst({
      where: {
        turfId: String(turfId),
        offerDate: normalizedDate,
        isActive: true,
      },
      include: {
        turf: {
          select: {
            id: true,
            name: true,
            pricePerHour: true,
            slotPrices: true,
          }
        }
      }
    });

    if (!offer) {
      return res.json({ hasBogo: false, offer: null });
    }

    res.json({
      hasBogo: true,
      offer: {
        id: offer.id,
        turfId: offer.turfId,
        turfName: offer.turf.name,
        offerDate: offer.offerDate,
        offerType: offer.offerType,
        isActive: offer.isActive,
      }
    });
  } catch (error) {
    console.error('Check BOGO offer error:', error);
    res.status(500).json({ hasBogo: false, error: 'Failed to check BOGO offer' });
  }
});

// Get all BOGO offers for turfs owned by the authenticated Turf Owner
router.get('/owner', authenticateToken, requireRole(['owner']), async (req: Request, res: Response): Promise<any> => {
  try {
    const authUser = (req as any).user;
    const { turfId } = req.query;

    // Get owner's turfs
    const ownerTurfs = await prisma.turf.findMany({
      where: { ownerId: authUser.id },
      select: { id: true, name: true }
    });

    const ownerTurfIds = ownerTurfs.map((t) => t.id);

    if (ownerTurfIds.length === 0) {
      return res.json([]);
    }

    const targetTurfIds = turfId && ownerTurfIds.includes(String(turfId))
      ? [String(turfId)]
      : ownerTurfIds;

    const offers = await prisma.bOGOOffer.findMany({
      where: {
        turfId: { in: targetTurfIds }
      },
      include: {
        turf: {
          select: { id: true, name: true, location: true }
        }
      },
      orderBy: { offerDate: 'desc' }
    });

    res.json(
      offers.map((o) => ({
        id: o.id,
        turfId: o.turfId,
        turfName: o.turf.name,
        offerDate: o.offerDate,
        offerType: o.offerType,
        isActive: o.isActive,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt
      }))
    );
  } catch (error) {
    console.error('Fetch owner BOGO offers error:', error);
    res.status(500).json({ error: 'Failed to fetch BOGO offers' });
  }
});

// Create a new BOGO offer (Owner)
router.post('/', authenticateToken, requireRole(['owner']), async (req: Request, res: Response): Promise<any> => {
  try {
    const authUser = (req as any).user;
    const { turfId, offerDate, offerType, isActive } = req.body;

    if (!turfId || !offerDate) {
      return res.status(400).json({ error: 'turfId and offerDate are required' });
    }

    const normalizedDate = normalizeDateStr(offerDate);
    if (!normalizedDate || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      return res.status(400).json({ error: 'Please enter a valid offer date (YYYY-MM-DD)' });
    }

    // Authorization check: Verify turf belongs to logged-in owner
    const turf = await prisma.turf.findUnique({
      where: { id: String(turfId) },
      select: { id: true, ownerId: true, name: true }
    });

    if (!turf) {
      return res.status(404).json({ error: 'Turf not found' });
    }

    if (turf.ownerId !== authUser.id) {
      return res.status(403).json({ error: 'Unauthorized: You do not own this turf.' });
    }

    // Check duplicate offer for same turf and date
    const existingOffer = await prisma.bOGOOffer.findUnique({
      where: {
        turfId_offerDate: {
          turfId: turf.id,
          offerDate: normalizedDate
        }
      }
    });

    if (existingOffer) {
      return res.status(409).json({
        error: `A BOGO offer already exists for ${turf.name} on ${normalizedDate}. You can edit or activate the existing offer.`
      });
    }

    const newOffer = await prisma.bOGOOffer.create({
      data: {
        turfId: turf.id,
        offerDate: normalizedDate,
        offerType: offerType || 'BUY_1_GET_1',
        isActive: isActive !== undefined ? Boolean(isActive) : true,
      },
      include: {
        turf: { select: { name: true } }
      }
    });

    res.status(201).json({
      id: newOffer.id,
      turfId: newOffer.turfId,
      turfName: newOffer.turf.name,
      offerDate: newOffer.offerDate,
      offerType: newOffer.offerType,
      isActive: newOffer.isActive,
      createdAt: newOffer.createdAt
    });
  } catch (error: any) {
    console.error('Create BOGO offer error:', error);
    res.status(500).json({ error: error.message || 'Failed to create BOGO offer' });
  }
});

// Update status (Active / Inactive) of BOGO offer (Owner)
router.patch('/:id/status', authenticateToken, requireRole(['owner']), async (req: Request, res: Response): Promise<any> => {
  try {
    const authUser = (req as any).user;
    const { id } = req.params;
    const { isActive } = req.body;

    if (isActive === undefined) {
      return res.status(400).json({ error: 'isActive status is required' });
    }

    const offer = await prisma.bOGOOffer.findUnique({
      where: { id: String(id) },
      include: { turf: { select: { ownerId: true } } }
    });

    if (!offer) {
      return res.status(404).json({ error: 'BOGO offer not found' });
    }

    if (offer.turf.ownerId !== authUser.id) {
      return res.status(403).json({ error: 'Unauthorized: You do not own the turf associated with this offer.' });
    }

    const updated = await prisma.bOGOOffer.update({
      where: { id: offer.id },
      data: { isActive: Boolean(isActive) }
    });

    res.json(updated);
  } catch (error) {
    console.error('Update BOGO offer status error:', error);
    res.status(500).json({ error: 'Failed to update offer status' });
  }
});

// Update BOGO offer details (Owner)
router.put('/:id', authenticateToken, requireRole(['owner']), async (req: Request, res: Response): Promise<any> => {
  try {
    const authUser = (req as any).user;
    const { id } = req.params;
    const { offerDate, offerType, isActive } = req.body;

    const offer = await prisma.bOGOOffer.findUnique({
      where: { id: String(id) },
      include: { turf: { select: { ownerId: true } } }
    });

    if (!offer) {
      return res.status(404).json({ error: 'BOGO offer not found' });
    }

    if (offer.turf.ownerId !== authUser.id) {
      return res.status(403).json({ error: 'Unauthorized: You do not own the turf associated with this offer.' });
    }

    const updateData: any = {};
    if (offerDate) {
      const normalized = normalizeDateStr(offerDate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        return res.status(400).json({ error: 'Please enter a valid date (YYYY-MM-DD)' });
      }
      updateData.offerDate = normalized;
    }

    if (offerType) updateData.offerType = String(offerType);
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);

    const updated = await prisma.bOGOOffer.update({
      where: { id: offer.id },
      data: updateData
    });

    res.json(updated);
  } catch (error) {
    console.error('Update BOGO offer error:', error);
    res.status(500).json({ error: 'Failed to update offer' });
  }
});

// Delete BOGO offer (Owner)
router.delete('/:id', authenticateToken, requireRole(['owner']), async (req: Request, res: Response): Promise<any> => {
  try {
    const authUser = (req as any).user;
    const { id } = req.params;

    const offer = await prisma.bOGOOffer.findUnique({
      where: { id: String(id) },
      include: { turf: { select: { ownerId: true } } }
    });

    if (!offer) {
      return res.status(404).json({ error: 'BOGO offer not found' });
    }

    if (offer.turf.ownerId !== authUser.id) {
      return res.status(403).json({ error: 'Unauthorized: You do not own the turf associated with this offer.' });
    }

    await prisma.bOGOOffer.delete({
      where: { id: offer.id }
    });

    res.json({ success: true, message: 'BOGO offer deleted successfully' });
  } catch (error) {
    console.error('Delete BOGO offer error:', error);
    res.status(500).json({ error: 'Failed to delete offer' });
  }
});

export default router;

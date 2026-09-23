import { Request, Response, Router } from 'express';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middlewares/authMiddleware';
import { razorpayClient, razorpayKeyId } from '../config/razorpay';

const router = Router();
const prisma = new PrismaClient();

const generateRegistrationId = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'KICKO-T-';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// ==========================================
// PUBLIC ENDPOINTS
// ==========================================

// GET /api/tournaments - Browse available tournaments
router.get('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const { sport, turfId, status } = req.query as {
      sport?: string;
      turfId?: string;
      status?: string;
    };

    const whereClause: any = {};

    if (status) {
      whereClause.status = status;
    } else {
      // Exclude Drafts for public browsing
      whereClause.status = { in: ['Registration Open', 'Registration Closed', 'Ongoing', 'Completed'] };
    }

    if (sport) {
      whereClause.sport = { equals: sport, mode: 'insensitive' };
    }

    if (turfId) {
      whereClause.turfId = turfId;
    }

    const tournaments = await prisma.tournament.findMany({
      where: whereClause,
      include: {
        turf: {
          select: {
            id: true,
            name: true,
            location: true,
            city: true,
            area: true,
            images: true,
          }
        },
        _count: {
          select: { registrations: { where: { registrationStatus: 'CONFIRMED' } } }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(tournaments);
  } catch (error: any) {
    console.error('Error fetching tournaments:', error);
    res.status(500).json({ error: 'Failed to fetch tournaments' });
  }
});

// GET /api/tournaments/my-registrations - User's registrations
router.get('/my-registrations', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User authentication required' });
    }

    const registrations = await prisma.tournamentRegistration.findMany({
      where: { userId },
      include: {
        tournament: {
          include: {
            turf: {
              select: {
                id: true,
                name: true,
                location: true,
                city: true,
                area: true,
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(registrations);
  } catch (error: any) {
    console.error('Error fetching user registrations:', error);
    res.status(500).json({ error: 'Failed to fetch user registrations' });
  }
});

// GET /api/tournaments/owner - List tournaments for logged-in Turf Owner
router.get('/owner', authenticateToken, requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const ownerId = req.user?.id;
    if (!ownerId) {
      return res.status(401).json({ error: 'Owner authentication required' });
    }

    // Find all turfs owned by this owner
    const ownerTurfs = await prisma.turf.findMany({
      where: { ownerId },
      select: { id: true }
    });

    const turfIds = ownerTurfs.map(t => t.id);

    const tournaments = await prisma.tournament.findMany({
      where: { turfId: { in: turfIds } },
      include: {
        turf: {
          select: {
            id: true,
            name: true,
            location: true,
            city: true,
          }
        },
        _count: {
          select: { registrations: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(tournaments);
  } catch (error: any) {
    console.error('Error fetching owner tournaments:', error);
    res.status(500).json({ error: 'Failed to fetch owner tournaments' });
  }
});

// GET /api/tournaments/:id - Single tournament details
router.get('/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const tournament = await prisma.tournament.findUnique({
      where: { id },
      include: {
        turf: {
          select: {
            id: true,
            name: true,
            location: true,
            city: true,
            area: true,
            images: true,
            amenities: true,
          }
        },
        _count: {
          select: { registrations: { where: { registrationStatus: 'CONFIRMED' } } }
        }
      }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    res.json(tournament);
  } catch (error: any) {
    console.error('Error fetching tournament details:', error);
    res.status(500).json({ error: 'Failed to fetch tournament details' });
  }
});

// ==========================================
// TURF OWNER ENDPOINTS
// ==========================================

// POST /api/tournaments - Create new tournament
router.post('/', authenticateToken, requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const ownerId = req.user?.id;
    const {
      turfId,
      name,
      sport,
      description,
      bannerUrl,
      tournamentType,
      registrationStartDate,
      registrationEndDate,
      startDate,
      endDate,
      matchStartTime,
      reportingTime,
      maxTeams,
      minTeams,
      playersPerTeam,
      substitutePlayers,
      registrationType,
      registrationFee,
      paymentRequired,
      firstPrize,
      secondPrize,
      thirdPrize,
      mvpPrize,
      otherPrizes,
      rules,
      contactName,
      contactPhone,
      whatsappNumber,
      contactEmail,
      status,
    } = req.body;

    if (!turfId || !name || !sport || !registrationStartDate || !registrationEndDate || !startDate || !endDate || !maxTeams || !playersPerTeam || !contactName || !contactPhone) {
      return res.status(400).json({ error: 'Missing required tournament fields' });
    }

    // Verify turf ownership
    const turf = await prisma.turf.findUnique({ where: { id: turfId } });
    if (!turf) {
      return res.status(404).json({ error: 'Selected turf not found' });
    }

    if (turf.ownerId !== ownerId && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized: You do not own this turf' });
    }

    const tournament = await prisma.tournament.create({
      data: {
        turfId,
        name: String(name).trim(),
        sport: String(sport).trim(),
        description: description ? String(description).trim() : null,
        bannerUrl: bannerUrl ? String(bannerUrl).trim() : null,
        tournamentType: tournamentType || 'Knockout',
        registrationStartDate,
        registrationEndDate,
        startDate,
        endDate,
        matchStartTime: matchStartTime || null,
        reportingTime: reportingTime || null,
        maxTeams: Number(maxTeams),
        minTeams: Number(minTeams || 2),
        playersPerTeam: Number(playersPerTeam),
        substitutePlayers: Number(substitutePlayers || 0),
        registrationType: registrationType || 'Team Registration',
        registrationFee: Number(registrationFee || 0),
        paymentRequired: Boolean(paymentRequired),
        firstPrize: firstPrize ? String(firstPrize).trim() : null,
        secondPrize: secondPrize ? String(secondPrize).trim() : null,
        thirdPrize: thirdPrize ? String(thirdPrize).trim() : null,
        mvpPrize: mvpPrize ? String(mvpPrize).trim() : null,
        otherPrizes: otherPrizes ? String(otherPrizes).trim() : null,
        rules: rules ? String(rules).trim() : null,
        contactName: String(contactName).trim(),
        contactPhone: String(contactPhone).trim(),
        whatsappNumber: whatsappNumber ? String(whatsappNumber).trim() : null,
        contactEmail: contactEmail ? String(contactEmail).trim() : null,
        status: status || 'Draft',
      }
    });

    res.status(201).json(tournament);
  } catch (error: any) {
    console.error('Error creating tournament:', error);
    res.status(500).json({ error: 'Failed to create tournament' });
  }
});

// PUT /api/tournaments/:id - Update tournament
router.put('/:id', authenticateToken, requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const ownerId = req.user?.id;
    const id = req.params.id as string;

    const existing = await prisma.tournament.findUnique({
      where: { id },
      include: { turf: true }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (existing.turf.ownerId !== ownerId && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized: You do not own this tournament' });
    }

    const {
      name,
      sport,
      description,
      bannerUrl,
      tournamentType,
      registrationStartDate,
      registrationEndDate,
      startDate,
      endDate,
      matchStartTime,
      reportingTime,
      maxTeams,
      minTeams,
      playersPerTeam,
      substitutePlayers,
      registrationType,
      registrationFee,
      paymentRequired,
      firstPrize,
      secondPrize,
      thirdPrize,
      mvpPrize,
      otherPrizes,
      rules,
      contactName,
      contactPhone,
      whatsappNumber,
      contactEmail,
      status,
    } = req.body;

    const updated = await prisma.tournament.update({
      where: { id },
      data: {
        ...(name && { name: String(name).trim() }),
        ...(sport && { sport: String(sport).trim() }),
        description: description !== undefined ? (description ? String(description).trim() : null) : existing.description,
        bannerUrl: bannerUrl !== undefined ? (bannerUrl ? String(bannerUrl).trim() : null) : existing.bannerUrl,
        ...(tournamentType && { tournamentType }),
        ...(registrationStartDate && { registrationStartDate }),
        ...(registrationEndDate && { registrationEndDate }),
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
        matchStartTime: matchStartTime !== undefined ? matchStartTime || null : existing.matchStartTime,
        reportingTime: reportingTime !== undefined ? reportingTime || null : existing.reportingTime,
        ...(maxTeams && { maxTeams: Number(maxTeams) }),
        ...(minTeams !== undefined && { minTeams: Number(minTeams) }),
        ...(playersPerTeam && { playersPerTeam: Number(playersPerTeam) }),
        ...(substitutePlayers !== undefined && { substitutePlayers: Number(substitutePlayers) }),
        ...(registrationType && { registrationType }),
        ...(registrationFee !== undefined && { registrationFee: Number(registrationFee) }),
        ...(paymentRequired !== undefined && { paymentRequired: Boolean(paymentRequired) }),
        firstPrize: firstPrize !== undefined ? (firstPrize ? String(firstPrize).trim() : null) : existing.firstPrize,
        secondPrize: secondPrize !== undefined ? (secondPrize ? String(secondPrize).trim() : null) : existing.secondPrize,
        thirdPrize: thirdPrize !== undefined ? (thirdPrize ? String(thirdPrize).trim() : null) : existing.thirdPrize,
        mvpPrize: mvpPrize !== undefined ? (mvpPrize ? String(mvpPrize).trim() : null) : existing.mvpPrize,
        otherPrizes: otherPrizes !== undefined ? (otherPrizes ? String(otherPrizes).trim() : null) : existing.otherPrizes,
        rules: rules !== undefined ? (rules ? String(rules).trim() : null) : existing.rules,
        ...(contactName && { contactName: String(contactName).trim() }),
        ...(contactPhone && { contactPhone: String(contactPhone).trim() }),
        whatsappNumber: whatsappNumber !== undefined ? (whatsappNumber ? String(whatsappNumber).trim() : null) : existing.whatsappNumber,
        contactEmail: contactEmail !== undefined ? (contactEmail ? String(contactEmail).trim() : null) : existing.contactEmail,
        ...(status && { status }),
      }
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating tournament:', error);
    res.status(500).json({ error: 'Failed to update tournament' });
  }
});

// PATCH /api/tournaments/:id/status - Update tournament status
router.patch('/:id/status', authenticateToken, requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const ownerId = req.user?.id;
    const id = req.params.id as string;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const existing = await prisma.tournament.findUnique({
      where: { id },
      include: { turf: true }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (existing.turf.ownerId !== ownerId && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized: You do not own this tournament' });
    }

    const updated = await prisma.tournament.update({
      where: { id },
      data: { status }
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating tournament status:', error);
    res.status(500).json({ error: 'Failed to update tournament status' });
  }
});

// DELETE /api/tournaments/:id - Delete tournament
router.delete('/:id', authenticateToken, requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const ownerId = req.user?.id;
    const id = req.params.id as string;

    const existing = await prisma.tournament.findUnique({
      where: { id },
      include: { turf: true }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (existing.turf.ownerId !== ownerId && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized: You do not own this tournament' });
    }

    await prisma.tournament.delete({ where: { id } });
    res.json({ message: 'Tournament deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting tournament:', error);
    res.status(500).json({ error: 'Failed to delete tournament' });
  }
});

// GET /api/tournaments/:id/registrations - Owner view registrations
router.get('/:id/registrations', authenticateToken, requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const ownerId = req.user?.id;
    const id = req.params.id as string;

    const tournament = await prisma.tournament.findUnique({
      where: { id },
      include: { turf: true }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (tournament.turf.ownerId !== ownerId && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized: You do not own this tournament' });
    }

    const registrations = await prisma.tournamentRegistration.findMany({
      where: { tournamentId: id },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(registrations);
  } catch (error: any) {
    console.error('Error fetching tournament registrations:', error);
    res.status(500).json({ error: 'Failed to fetch tournament registrations' });
  }
});

// PATCH /api/tournaments/registrations/:regId/status - Owner update registration status
router.patch('/registrations/:regId/status', authenticateToken, requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const ownerId = req.user?.id;
    const regId = req.params.regId as string;
    const { registrationStatus } = req.body;

    if (!registrationStatus) {
      return res.status(400).json({ error: 'registrationStatus is required' });
    }

    const reg = await prisma.tournamentRegistration.findUnique({
      where: { id: regId },
      include: { tournament: { include: { turf: true } } }
    });

    if (!reg) {
      return res.status(404).json({ error: 'Registration not found' });
    }

    if (reg.tournament.turf.ownerId !== ownerId && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized: You do not own this tournament' });
    }

    const updated = await prisma.tournamentRegistration.update({
      where: { id: regId },
      data: { registrationStatus }
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating registration status:', error);
    res.status(500).json({ error: 'Failed to update registration status' });
  }
});

// ==========================================
// USER REGISTRATION & PAYMENT ENDPOINTS
// ==========================================

// POST /api/tournaments/:id/register - User register for tournament
router.post('/:id/register', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required to register' });
    }

    const tournamentId = req.params.id as string;
    const {
      teamName,
      captainName,
      captainPhone,
      captainEmail,
      players,
      substitutes,
    } = req.body;

    // 1. Verify tournament exists
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        _count: {
          select: { registrations: { where: { registrationStatus: 'CONFIRMED' } } }
        }
      }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // 2. Validate tournament status
    if (tournament.status !== 'Registration Open') {
      return res.status(400).json({ error: `Registration is not open for this tournament (Status: ${tournament.status})` });
    }

    // 3. Validate registration date range
    const today = new Date().toISOString().split('T')[0];
    if (today < tournament.registrationStartDate) {
      return res.status(400).json({ error: `Registration opens on ${tournament.registrationStartDate}` });
    }
    if (today > tournament.registrationEndDate) {
      return res.status(400).json({ error: `Registration closed on ${tournament.registrationEndDate}` });
    }

    // 4. Validate capacity
    if (tournament._count.registrations >= tournament.maxTeams) {
      return res.status(400).json({ error: 'Tournament registration capacity has been reached' });
    }

    // 5. Validate duplicate registration for same user & tournament
    const existingRegistration = await prisma.tournamentRegistration.findUnique({
      where: {
        tournamentId_userId: {
          tournamentId,
          userId,
        }
      }
    });

    if (existingRegistration && existingRegistration.registrationStatus === 'CONFIRMED') {
      return res.status(400).json({ error: 'You are already registered for this tournament' });
    }

    // 6. Validate required fields & player count
    if (!captainName || !captainPhone || !Array.isArray(players)) {
      return res.status(400).json({ error: 'Captain name, phone, and players array are required' });
    }

    if (players.length !== tournament.playersPerTeam) {
      return res.status(400).json({ error: `Required player count is exactly ${tournament.playersPerTeam}` });
    }

    const regCode = generateRegistrationId();
    const isPaid = tournament.paymentRequired && tournament.registrationFee > 0;

    // Prepare arrays JSON string
    const playersJson = JSON.stringify(players);
    const substitutesJson = Array.isArray(substitutes) ? JSON.stringify(substitutes) : null;

    if (isPaid) {
      // Create Razorpay Order
      const amountInPaise = Math.round(tournament.registrationFee * 100);
      const order = await (razorpayClient.orders.create as any)({
        amount: amountInPaise,
        currency: 'INR',
        receipt: regCode,
        notes: {
          userId,
          tournamentId,
          registrationCode: regCode,
          teamName: teamName || 'Individual'
        }
      });

      // Save initial registration record (pending payment)
      const registration = await prisma.tournamentRegistration.upsert({
        where: {
          tournamentId_userId: { tournamentId, userId }
        },
        create: {
          tournamentId,
          userId,
          registrationId: regCode,
          teamName: teamName ? String(teamName).trim() : null,
          captainName: String(captainName).trim(),
          captainPhone: String(captainPhone).trim(),
          captainEmail: captainEmail ? String(captainEmail).trim() : null,
          players: playersJson,
          substitutes: substitutesJson,
          registrationStatus: 'PENDING',
          paymentStatus: 'PENDING',
          amount: tournament.registrationFee,
          paymentOrderId: order.id,
        },
        update: {
          registrationId: regCode,
          teamName: teamName ? String(teamName).trim() : null,
          captainName: String(captainName).trim(),
          captainPhone: String(captainPhone).trim(),
          captainEmail: captainEmail ? String(captainEmail).trim() : null,
          players: playersJson,
          substitutes: substitutesJson,
          registrationStatus: 'PENDING',
          paymentStatus: 'PENDING',
          amount: tournament.registrationFee,
          paymentOrderId: order.id,
        }
      });

      return res.status(201).json({
        paymentRequired: true,
        keyId: razorpayKeyId,
        order,
        registrationId: registration.registrationId,
        regId: registration.id,
        amount: tournament.registrationFee
      });
    } else {
      // Free Tournament
      const registration = await prisma.tournamentRegistration.upsert({
        where: {
          tournamentId_userId: { tournamentId, userId }
        },
        create: {
          tournamentId,
          userId,
          registrationId: regCode,
          teamName: teamName ? String(teamName).trim() : null,
          captainName: String(captainName).trim(),
          captainPhone: String(captainPhone).trim(),
          captainEmail: captainEmail ? String(captainEmail).trim() : null,
          players: playersJson,
          substitutes: substitutesJson,
          registrationStatus: 'CONFIRMED',
          paymentStatus: 'FREE',
          amount: 0,
        },
        update: {
          registrationId: regCode,
          teamName: teamName ? String(teamName).trim() : null,
          captainName: String(captainName).trim(),
          captainPhone: String(captainPhone).trim(),
          captainEmail: captainEmail ? String(captainEmail).trim() : null,
          players: playersJson,
          substitutes: substitutesJson,
          registrationStatus: 'CONFIRMED',
          paymentStatus: 'FREE',
          amount: 0,
        }
      });

      return res.status(201).json({
        paymentRequired: false,
        registration,
        message: 'Tournament registration confirmed successfully!'
      });
    }
  } catch (error: any) {
    console.error('Error registering for tournament:', error);
    res.status(500).json({ error: 'Failed to complete registration' });
  }
});

// POST /api/tournaments/payment/verify - Verify Razorpay payment for tournament registration
router.post('/payment/verify', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user?.id;
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      registrationId,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !registrationId) {
      return res.status(400).json({ error: 'Missing payment verification parameters' });
    }

    // Verify HMAC SHA256 Signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const receivedSigBuf = Buffer.from(razorpay_signature);
    const calculatedSigBuf = Buffer.from(expectedSignature);

    if (
      receivedSigBuf.length !== calculatedSigBuf.length ||
      !crypto.timingSafeEqual(receivedSigBuf, calculatedSigBuf)
    ) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    // Find registration record by registrationId or paymentOrderId
    const registration = await prisma.tournamentRegistration.findFirst({
      where: {
        OR: [
          { registrationId },
          { paymentOrderId: razorpay_order_id }
        ]
      }
    });

    if (!registration) {
      return res.status(404).json({ error: 'Registration record not found' });
    }

    // Update status to CONFIRMED and PAID
    const updated = await prisma.tournamentRegistration.update({
      where: { id: registration.id },
      data: {
        registrationStatus: 'CONFIRMED',
        paymentStatus: 'PAID',
        paymentId: razorpay_payment_id,
        paymentOrderId: razorpay_order_id,
      },
      include: {
        tournament: {
          include: {
            turf: {
              select: { name: true, location: true, city: true }
            }
          }
        }
      }
    });

    res.json({
      message: 'Payment verified and registration confirmed!',
      registration: updated,
    });
  } catch (error: any) {
    console.error('Error verifying tournament payment:', error);
    res.status(500).json({ error: 'Failed to verify tournament payment' });
  }
});

export default router;

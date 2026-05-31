"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBookingRecord = exports.ensureSlotsAreBookable = exports.getTurfSlotSnapshot = exports.cleanupExpiredOwnerBookedSlots = exports.parseOwnerBookedSlots = exports.parseBlockedSlotEntries = exports.cleanupLegacyBlockedSlots = exports.parseSlotList = exports.DEFAULT_SLOT_TIMES = exports.normalizeSlotLabel = void 0;
const express_1 = require("express");
const client_1 = require("@prisma/client");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
const normalizeSlotLabel = (slot) => slot.replace(/\s*[-\u2013\u2014]\s*/, ' - ').trim();
exports.normalizeSlotLabel = normalizeSlotLabel;
exports.DEFAULT_SLOT_TIMES = [
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
const parseSlotList = (value) => {
    if (!value)
        return [];
    try {
        const raw = typeof value === 'string' ? JSON.parse(value) : value;
        if (!Array.isArray(raw))
            return [];
        return raw
            .map((slot) => (0, exports.normalizeSlotLabel)(String(slot)))
            .filter((slot) => slot.length > 0);
    }
    catch {
        return [];
    }
};
exports.parseSlotList = parseSlotList;
const normalizeDateValue = (value) => String(value || '').trim();
const isBlockedEntryActiveForDate = (entry, date) => {
    if (!entry.date)
        return false;
    if (!date)
        return true;
    return normalizeDateValue(entry.date) === normalizeDateValue(date);
};
const cleanupLegacyBlockedSlots = async (client, turfId) => {
    const turf = await client.turf.findUnique({
        where: { id: turfId },
        select: { blockedSlots: true }
    });
    if (!turf) {
        return [];
    }
    const parsed = (0, exports.parseBlockedSlotEntries)(turf.blockedSlots);
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
exports.cleanupLegacyBlockedSlots = cleanupLegacyBlockedSlots;
const parseBlockedSlotEntries = (value) => {
    if (!value)
        return [];
    try {
        const raw = typeof value === 'string' ? JSON.parse(value) : value;
        if (!Array.isArray(raw))
            return [];
        return raw
            .map((item) => {
            if (typeof item === 'string') {
                return { slot: (0, exports.normalizeSlotLabel)(item) };
            }
            return {
                slot: (0, exports.normalizeSlotLabel)(String(item?.slot || '')),
                date: String(item?.date || '').trim() || undefined
            };
        })
            .filter((item) => item.slot);
    }
    catch {
        return [];
    }
};
exports.parseBlockedSlotEntries = parseBlockedSlotEntries;
const parseOwnerBookedSlots = (value) => {
    if (!value)
        return [];
    try {
        const raw = typeof value === 'string' ? JSON.parse(value) : value;
        if (!Array.isArray(raw))
            return [];
        return raw
            .map((item) => ({
            slot: (0, exports.normalizeSlotLabel)(String(item?.slot || '')),
            date: String(item?.date || '').trim(),
            releaseAt: String(item?.releaseAt || '').trim(),
        }))
            .filter((item) => item.slot && item.date && item.releaseAt);
    }
    catch {
        return [];
    }
};
exports.parseOwnerBookedSlots = parseOwnerBookedSlots;
const cleanupExpiredOwnerBookedSlots = async (client, turfId) => {
    const turf = await client.turf.findUnique({
        where: { id: turfId },
        select: { ownerBookedSlots: true }
    });
    if (!turf) {
        return [];
    }
    const now = new Date();
    const activeHolds = (0, exports.parseOwnerBookedSlots)(turf.ownerBookedSlots).filter((hold) => {
        const releaseAt = new Date(hold.releaseAt);
        return Number.isFinite(releaseAt.getTime()) && releaseAt > now;
    });
    const stored = (0, exports.parseOwnerBookedSlots)(turf.ownerBookedSlots);
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
exports.cleanupExpiredOwnerBookedSlots = cleanupExpiredOwnerBookedSlots;
const getTurfSlotSnapshot = async (client, turfId, date) => {
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
    const cleanedOwnerBookedSlots = await (0, exports.cleanupExpiredOwnerBookedSlots)(client, turfId);
    const activeSlots = (0, exports.parseSlotList)(turf.activeSlots);
    const approvedSlots = activeSlots.length > 0 ? activeSlots : exports.DEFAULT_SLOT_TIMES;
    const blockedSlotEntries = await (0, exports.cleanupLegacyBlockedSlots)(client, turfId);
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
    const bookedSlots = bookings.map((booking) => (0, exports.normalizeSlotLabel)(`${booking.startTime} - ${booking.endTime}`));
    const bookedSet = new Set(bookedSlots);
    const blockedSet = new Set(blockedSlots);
    const ownerBookedForDate = cleanedOwnerBookedSlots.filter((hold) => !date || hold.date === date);
    const ownerBookedSet = new Set(ownerBookedForDate.map((hold) => hold.slot));
    const slotStates = approvedSlots.map((slot) => {
        const normalizedSlot = (0, exports.normalizeSlotLabel)(slot);
        const hold = ownerBookedForDate.find((item) => item.slot === normalizedSlot);
        if (bookedSet.has(normalizedSlot)) {
            return { slot: normalizedSlot, state: 'BOOKED' };
        }
        if (blockedSet.has(normalizedSlot)) {
            return { slot: normalizedSlot, state: 'BLOCKED' };
        }
        if (ownerBookedSet.has(normalizedSlot)) {
            return {
                slot: normalizedSlot,
                state: 'OWNER_BOOKED',
                releaseAt: hold?.releaseAt,
            };
        }
        return { slot: normalizedSlot, state: 'OPEN' };
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
exports.getTurfSlotSnapshot = getTurfSlotSnapshot;
const ensureSlotsAreBookable = async (client, turfId, slots, date) => {
    const snapshot = await (0, exports.getTurfSlotSnapshot)(client, turfId, date);
    const activeSlotSet = new Set(snapshot.activeSlots);
    const stateMap = new Map(snapshot.slotStates.map((slot) => [slot.slot, slot]));
    for (const slot of slots) {
        const normalizedSlot = (0, exports.normalizeSlotLabel)(slot);
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
exports.ensureSlotsAreBookable = ensureSlotsAreBookable;
const createBookingRecord = async (client, bookingData) => {
    const requestedSlot = (0, exports.normalizeSlotLabel)(`${bookingData.startTime} - ${bookingData.endTime}`);
    await (0, exports.ensureSlotsAreBookable)(client, bookingData.turfId, [requestedSlot], bookingData.date);
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
    }
    catch (error) {
        if (error?.code === 'P2002') {
            throw new Error('Slot already booked or overlaps with an existing booking');
        }
        throw error;
    }
};
exports.createBookingRecord = createBookingRecord;
// Create a new booking
router.post('/', authMiddleware_1.authenticateToken, async (req, res) => {
    const { turfId, date, startTime, endTime } = req.body;
    const userId = req.user.id;
    try {
        const userExists = await prisma.user.findUnique({ where: { id: userId } });
        if (!userExists) {
            return res.status(401).json({ error: 'User not found. Please log in again to book a turf.' });
        }
        const booking = await prisma.$transaction(async (tx) => {
            return (0, exports.createBookingRecord)(tx, {
                userId,
                turfId,
                date,
                startTime,
                endTime
            });
        });
        res.status(201).json(booking);
    }
    catch (error) {
        res.status(400).json({ error: error.message || 'Failed to create booking' });
    }
});
// Get all bookings for a user
router.get('/user/:userId', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const reqUserId = req.params.userId;
        const authUser = req.user;
        if (authUser.id !== reqUserId && authUser.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized access to user bookings.' });
        }
        const bookings = await prisma.booking.findMany({
            where: { userId: String(req.params.userId) },
            include: { turf: true }
        });
        res.json(bookings);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
});
// Get all bookings for a turf on a specific date
router.get('/turf/:turfId', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const authUser = req.user;
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
        const whereClause = { turfId: req.params.turfId };
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
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
});
// Get a specific booking by ID
router.get('/:id', async (req, res) => {
    try {
        const booking = await prisma.booking.findUnique({
            where: { id: String(req.params.id) },
            include: { turf: true, user: true }
        });
        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        res.json(booking);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch booking' });
    }
});
exports.default = router;

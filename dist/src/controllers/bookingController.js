"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBookingRecord = void 0;
const express_1 = require("express");
const client_1 = require("@prisma/client");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
const createBookingRecord = async (client, bookingData) => {
    const overlappingBookings = await client.booking.findMany({
        where: {
            turfId: bookingData.turfId,
            date: bookingData.date,
            status: 'CONFIRMED',
            startTime: bookingData.startTime,
            endTime: bookingData.endTime
        }
    });
    if (overlappingBookings.length > 0) {
        throw new Error('Slot already booked or overlaps with an existing booking');
    }
    return client.booking.create({
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
};
exports.createBookingRecord = createBookingRecord;
// Create a new booking
router.post('/', async (req, res) => {
    const { userId, turfId, date, startTime, endTime } = req.body;
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
router.get('/user/:userId', async (req, res) => {
    try {
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
router.get('/turf/:turfId', async (req, res) => {
    try {
        const { date } = req.query;
        const whereClause = { turfId: req.params.turfId };
        if (date) {
            whereClause.date = String(date);
        }
        const bookings = await prisma.booking.findMany({
            where: whereClause,
            include: { user: { select: { id: true, name: true } } }
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

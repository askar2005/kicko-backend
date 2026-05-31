"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const client_1 = require("@prisma/client");
const razorpay_1 = require("../config/razorpay");
const bookingController_1 = require("./bookingController");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
const serviceFee = 50;
const parseSlot = (slot) => {
    const parts = slot.split(/\s[–-]\s/);
    if (parts.length !== 2) {
        throw new Error(`Invalid slot format: ${slot}`);
    }
    const [startTime, endTime] = parts.map((part) => part.trim());
    if (!startTime || !endTime) {
        throw new Error(`Invalid slot format: ${slot}`);
    }
    return { startTime, endTime };
};
router.post('/create-order', async (req, res) => {
    try {
        const { userId, turfId, date, slots } = req.body;
        if (!userId || !turfId || !date || !Array.isArray(slots) || slots.length === 0) {
            return res.status(400).json({ error: 'userId, turfId, date, and slots are required' });
        }
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const turf = await prisma.turf.findUnique({ where: { id: turfId } });
        if (!turf) {
            return res.status(404).json({ error: 'Turf not found' });
        }
        const amount = Math.round((turf.pricePerHour * slots.length + serviceFee) * 100);
        const receipt = `KO${Date.now().toString().slice(-8)}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const order = await razorpay_1.razorpayClient.orders.create({
            amount,
            currency: 'INR',
            receipt,
            notes: {
                userId,
                turfId,
                date,
                slots: JSON.stringify(slots)
            }
        });
        res.status(201).json({
            keyId: razorpay_1.razorpayKeyId,
            order,
            amount,
            currency: 'INR',
            receipt,
            serviceFee
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Failed to create payment order' });
    }
});
router.post('/verify-payment', async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId, turfId, date, slots } = req.body;
        if (!razorpay_order_id ||
            !razorpay_payment_id ||
            !razorpay_signature ||
            !userId ||
            !turfId ||
            !date ||
            !Array.isArray(slots) ||
            slots.length === 0) {
            return res.status(400).json({ error: 'Missing payment verification data' });
        }
        const expectedSignature = crypto_1.default
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');
        const receivedSignature = Buffer.from(razorpay_signature);
        const calculatedSignature = Buffer.from(expectedSignature);
        if (receivedSignature.length !== calculatedSignature.length ||
            !crypto_1.default.timingSafeEqual(receivedSignature, calculatedSignature)) {
            return res.status(400).json({ error: 'Invalid payment signature' });
        }
        const existingBookings = await prisma.booking.findMany({
            where: { paymentId: razorpay_payment_id }
        });
        if (existingBookings.length > 0) {
            return res.status(200).json({
                message: 'Payment already verified',
                bookings: existingBookings
            });
        }
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const turf = await prisma.turf.findUnique({ where: { id: turfId } });
        if (!turf) {
            return res.status(404).json({ error: 'Turf not found' });
        }
        const bookingResults = await prisma.$transaction(async (tx) => {
            const createdBookings = [];
            for (const slot of slots) {
                const { startTime, endTime } = parseSlot(slot);
                const booking = await (0, bookingController_1.createBookingRecord)(tx, {
                    userId,
                    turfId,
                    date,
                    startTime,
                    endTime,
                    paymentOrderId: razorpay_order_id,
                    paymentId: razorpay_payment_id,
                    paymentStatus: 'PAID'
                });
                createdBookings.push(booking);
            }
            return createdBookings;
        });
        res.status(200).json({
            message: 'Payment verified and booking confirmed',
            bookings: bookingResults,
            paymentId: razorpay_payment_id,
            orderId: razorpay_order_id,
            amount: Math.round((turf.pricePerHour * slots.length + serviceFee) * 100)
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Failed to verify payment' });
    }
});
exports.default = router;

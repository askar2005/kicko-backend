import 'dotenv/config';
import { Request, Response, Router } from 'express';
import crypto from 'crypto';
import { Booking, PrismaClient } from '@prisma/client';
import { razorpayClient, razorpayKeyId } from '../config/razorpay';
import { createBookingRecord, ensureSlotsAreBookable } from './bookingController';

const router = Router();
const prisma = new PrismaClient();

type BookingSlot = {
  startTime: string;
  endTime: string;
};

const parseSlot = (slot: string): BookingSlot => {
  const normalized = slot.replace(/\s*[-\u2013\u2014]\s*/, ' - ').trim();
  const parts = normalized.split(' - ');

  if (parts.length !== 2) {
    throw new Error(`Invalid slot format: ${slot}`);
  }

  const [startTime, endTime] = parts.map((part) => part.trim());

  if (!startTime || !endTime) {
    throw new Error(`Invalid slot format: ${slot}`);
  }

  return { startTime, endTime };
};

const getErrorMessage = (error: unknown, fallback: string) => {
  const err = error as any;
  return (
    err?.error?.description ||
    err?.response?.data?.error?.description ||
    err?.message ||
    fallback
  );
};

const resolveBookingUser = async ({
  userId,
  guestName,
  guestEmail
}: {
  userId?: string;
  guestName?: string;
  guestEmail?: string;
}) => {
  if (userId) {
    const existingUser = await prisma.user.findUnique({ where: { id: userId } });
    if (existingUser) {
      return existingUser;
    }
  }

  const email = (guestEmail || `guest_${crypto.randomUUID()}@kicko.local`).trim();
  const name = (guestName || 'Guest User').trim() || 'Guest User';

  const existingGuest = await prisma.user.findUnique({ where: { email } });
  if (existingGuest) {
    return existingGuest;
  }

  return prisma.user.create({
    data: {
      name,
      email,
      phone: null
    }
  });
};

const calculateTotalAmount = (turf: any, slots: string[]): number => {
  let slotPricesMap: Record<string, any> = {};
  try {
    if (turf.slotPrices) {
      slotPricesMap = typeof turf.slotPrices === 'string' ? JSON.parse(turf.slotPrices) : turf.slotPrices;
    }
  } catch (e) {
    console.error('Failed to parse slotPrices JSON:', e);
  }

  let totalSlotsPrice = 0;
  for (const slot of slots) {
    const priceVal = slotPricesMap[slot];
    const price = priceVal !== undefined ? parseFloat(String(priceVal)) : turf.pricePerHour;
    totalSlotsPrice += price;
  }

  return Math.round(totalSlotsPrice * 100);
};

router.post('/create-order', async (req: Request, res: Response): Promise<any> => {
  try {
    const { turfId, date, slots, userId, guestName, guestEmail } = req.body as {
      turfId?: string;
      date?: string;
      slots?: string[];
      userId?: string;
      guestName?: string;
      guestEmail?: string;
    };

    if (!turfId || !date || !Array.isArray(slots) || slots.length === 0) {
      return res.status(400).json({ error: 'turfId, date, and slots are required' });
    }

    const user = await resolveBookingUser({ userId, guestName, guestEmail });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const turf = await prisma.turf.findUnique({ where: { id: turfId } });
    if (!turf) {
      return res.status(404).json({ error: 'Turf not found' });
    }

    await ensureSlotsAreBookable(prisma, turfId, slots, date);

    const amount = calculateTotalAmount(turf, slots);
    const receipt = `KO${Date.now().toString().slice(-8)}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const order = await razorpayClient.orders.create({
      amount,
      currency: 'INR',
      receipt,
      notes: {
        userId: user.id,
        turfId,
        date,
        slots: JSON.stringify(slots)
      }
    });

    res.status(201).json({
      keyId: razorpayKeyId,
      order,
      amount,
      currency: 'INR',
      receipt
    });
  } catch (error: any) {
    console.error('Create order error:', error);
    res.status(500).json({ error: getErrorMessage(error, 'Failed to create payment order') });
  }
});

router.post('/verify-payment', async (req: Request, res: Response): Promise<any> => {
  try {
    const { 
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      turfId,
      date,
      slots,
      userId,
      guestName,
      guestEmail
    } = req.body as {
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      razorpay_signature?: string;
      turfId?: string;
      date?: string;
      slots?: string[];
      userId?: string;
      guestName?: string;
      guestEmail?: string;
    };

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature ||
      !turfId ||
      !date ||
      !Array.isArray(slots) ||
      slots.length === 0
    ) {
      return res.status(400).json({ error: 'Missing payment verification data' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const receivedSignature = Buffer.from(razorpay_signature);
    const calculatedSignature = Buffer.from(expectedSignature);

    if (
      receivedSignature.length !== calculatedSignature.length ||
      !crypto.timingSafeEqual(receivedSignature, calculatedSignature)
    ) {
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

    const user = await resolveBookingUser({ userId, guestName, guestEmail });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const turf = await prisma.turf.findUnique({ where: { id: turfId } });
    if (!turf) {
      return res.status(404).json({ error: 'Turf not found' });
    }

    await ensureSlotsAreBookable(prisma, turfId, slots, date);

    const bookingResults = await prisma.$transaction(async (tx) => {
      const createdBookings: Booking[] = [];

      for (const slot of slots) {
        const { startTime, endTime } = parseSlot(slot);
        const booking = await createBookingRecord(tx, {
          userId: user.id,
          turfId: turfId as string,
          date: date as string,
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
      amount: calculateTotalAmount(turf, slots)
    });
  } catch (error: any) {
    console.error('Verify payment error:', error);
    res.status(500).json({ error: getErrorMessage(error, 'Failed to verify payment') });
  }
});

export default router;

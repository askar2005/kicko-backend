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

const calculateBogoPaymentDetails = (
  turf: any,
  slots: string[],
  isBogoActive: boolean
) => {
  let slotPricesMap: Record<string, number> = {};
  try {
    if (turf.slotPrices) {
      const parsed = typeof turf.slotPrices === 'string' ? JSON.parse(turf.slotPrices) : turf.slotPrices;
      if (parsed && typeof parsed === 'object') {
        Object.entries(parsed).forEach(([slot, price]) => {
          const amount = Number(price);
          if (Number.isFinite(amount)) {
            slotPricesMap[slot.replace(/\s*[-\u2013\u2014]\s*/, ' - ').trim()] = amount;
          }
        });
      }
    }
  } catch (e) {
    console.error('Failed to parse slotPrices JSON:', e);
  }

  const slotPrices = slots.map((slot) => {
    const norm = slot.replace(/\s*[-\u2013\u2014]\s*/, ' - ').trim();
    const price = slotPricesMap[norm] !== undefined ? slotPricesMap[norm] : Number(turf.pricePerHour || 1200);
    return { slot: norm, price };
  });

  const totalOriginalPrice = slotPrices.reduce((sum, item) => sum + item.price, 0);

  if (isBogoActive && slots.length >= 2) {
    const freeSlotItem = slotPrices[1] || slotPrices[slotPrices.length - 1];
    const discountAmount = freeSlotItem.price;
    const payableAmount = Math.max(0, totalOriginalPrice - discountAmount);

    return {
      payableAmountInPaise: Math.round(payableAmount * 100),
      payableAmount,
      totalOriginalPrice,
      discountAmount,
      freeSlot: freeSlotItem.slot,
      isBogo: true,
    };
  }

  return {
    payableAmountInPaise: Math.round(totalOriginalPrice * 100),
    payableAmount: totalOriginalPrice,
    totalOriginalPrice,
    discountAmount: 0,
    freeSlot: null,
    isBogo: false,
  };
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

    // Check active BOGO offer for this turf and date
    const bogoOffer = await prisma.bOGOOffer.findFirst({
      where: {
        turfId,
        offerDate: date,
        isActive: true,
      }
    });

    const isBogoActive = Boolean(bogoOffer && slots.length >= 2);
    const bogoDetails = calculateBogoPaymentDetails(turf, slots, isBogoActive);

    const amount = bogoDetails.payableAmountInPaise;
    const receipt = `KO${Date.now().toString().slice(-8)}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const order = await razorpayClient.orders.create({
      amount,
      currency: 'INR',
      receipt,
      notes: {
        userId: user.id,
        turfId,
        date,
        slots: JSON.stringify(slots),
        isBogo: isBogoActive ? 'true' : 'false',
        bogoOfferId: bogoOffer?.id || '',
        freeSlot: bogoDetails.freeSlot || '',
        discountAmount: String(bogoDetails.discountAmount),
        originalAmount: String(bogoDetails.totalOriginalPrice)
      }
    });

    res.status(201).json({
      keyId: razorpayKeyId,
      order,
      amount,
      currency: 'INR',
      receipt,
      isBogo: bogoDetails.isBogo,
      discountAmount: bogoDetails.discountAmount,
      originalAmount: bogoDetails.totalOriginalPrice,
      freeSlot: bogoDetails.freeSlot,
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

    // Check active BOGO offer for metadata logging
    const bogoOffer = await prisma.bOGOOffer.findFirst({
      where: {
        turfId,
        offerDate: date,
        isActive: true,
      }
    });

    const isBogoActive = Boolean(bogoOffer && slots.length >= 2);
    const bogoDetails = calculateBogoPaymentDetails(turf, slots, isBogoActive);

    const bookingResults = await prisma.$transaction(async (tx) => {
      const createdBookings: Booking[] = [];

      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const { startTime, endTime } = parseSlot(slot);
        const normSlot = slot.replace(/\s*[-\u2013\u2014]\s*/, ' - ').trim();
        const isThisSlotFree = isBogoActive && normSlot === bogoDetails.freeSlot;

        const booking = await createBookingRecord(tx, {
          userId: user.id,
          turfId: turfId as string,
          date: date as string,
          startTime,
          endTime,
          paymentOrderId: razorpay_order_id,
          paymentId: razorpay_payment_id,
          paymentStatus: 'PAID',
          isBogo: isBogoActive,
          bogoOfferId: bogoOffer?.id || undefined,
          freeSlot: bogoDetails.freeSlot || undefined,
          discountAmount: isThisSlotFree ? bogoDetails.discountAmount : (isBogoActive ? bogoDetails.discountAmount : 0),
          originalAmount: bogoDetails.totalOriginalPrice,
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
      amount: bogoDetails.payableAmountInPaise,
      isBogo: bogoDetails.isBogo,
      discountAmount: bogoDetails.discountAmount,
      originalAmount: bogoDetails.totalOriginalPrice,
      freeSlot: bogoDetails.freeSlot,
    });
  } catch (error: any) {
    console.error('Verify payment error:', error);
    res.status(500).json({ error: getErrorMessage(error, 'Failed to verify payment') });
  }
});

export default router;

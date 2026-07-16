import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import http from 'http';
import { Server } from 'socket.io';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import bookingController from './controllers/bookingController';
import paymentController from './controllers/paymentController';
import turfController from './controllers/turfController';
import authController from './controllers/authController';

dotenv.config();

const app = express();
const prisma = new PrismaClient();

const formatMonthKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const formatMonthLabel = (date: Date) =>
  date.toLocaleString('en-US', { month: 'short' });

const buildMonthSeries = (months = 6) => {
  const series: Array<{ key: string; name: string; revenue: number; bookings: number }> = [];
  const now = new Date();

  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    series.push({
      key: formatMonthKey(date),
      name: formatMonthLabel(date),
      revenue: 0,
      bookings: 0,
    });
  }

  return series;
};

const parseSlotPrices = (value: unknown): Record<string, number> => {
  if (!value) return {};

  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    return Object.entries(parsed).reduce<Record<string, number>>((acc, [slot, price]) => {
      const amount = Number(price);
      if (Number.isFinite(amount)) {
        acc[slot] = amount;
      }
      return acc;
    }, {});
  } catch {
    return {};
  }
};

const normalizeSlotLabel = (slot: string) =>
  slot.replace(/\s*[-\u2013\u2014]\s*/, ' - ').trim();

const calculateBookingRevenue = (booking: {
  startTime: string;
  endTime: string;
  turf: { pricePerHour: number; slotPrices: string | null };
}) => {
  const slotLabel = normalizeSlotLabel(`${booking.startTime} - ${booking.endTime}`);
  const slotPrices = parseSlotPrices(booking.turf.slotPrices);
  const slotPrice = slotPrices[slotLabel];

  if (Number.isFinite(slotPrice)) {
    return slotPrice;
  }

  return Number(booking.turf.pricePerHour || 0);
};

// Setup Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
});
// Apply rate limiting middleware to all requests
app.use(limiter);

// Setup WebSockets Server
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

io.on('connection', (socket) => {
  console.log('A user connected via WebSocket:', socket.id);
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Basic health check
app.get('/', (req, res) => {
  res.send('Kicko Backend is running!');
});

app.get('/api/admin/dashboard-metrics', async (req, res) => {
  try {
    const months = buildMonthSeries(6);
    const bookings = await prisma.booking.findMany({
      where: { status: 'CONFIRMED' },
      select: {
        createdAt: true,
        startTime: true,
        endTime: true,
        turf: {
          select: {
            pricePerHour: true,
            slotPrices: true
          }
        }
      }
    });

    for (const booking of bookings) {
      const bookingDate = new Date(booking.createdAt);
      const monthKey = formatMonthKey(bookingDate);
      const monthBucket = months.find((item) => item.key === monthKey);
      if (!monthBucket) continue;

      monthBucket.bookings += 1;
      monthBucket.revenue += calculateBookingRevenue(booking);
    }

    const [activeUsers, approvedTurfs] = await Promise.all([
      prisma.user.count(),
      prisma.turf.count({ where: { status: 'APPROVED' } })
    ]);

    res.json({
      revenueData: months.map(({ name, revenue }) => ({
        name,
        revenue: Math.round(revenue)
      })),
      bookingData: months.map(({ name, bookings }) => ({
        name,
        bookings
      })),
      summary: {
        activeUsers,
        approvedTurfs,
        pendingSettlements: 0,
        refundRatio: '0.0%'
      }
    });
  } catch (error) {
    console.error('Dashboard metrics error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard metrics' });
  }
});

// Routes
app.use('/api/bookings', bookingController);
app.use('/api/payments', paymentController);
app.use('/api/turfs', turfController);
app.use('/api/auth', authController);

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

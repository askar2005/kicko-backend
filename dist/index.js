"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const client_1 = require("@prisma/client");
const bookingController_1 = __importDefault(require("./controllers/bookingController"));
const paymentController_1 = __importDefault(require("./controllers/paymentController"));
const turfController_1 = __importDefault(require("./controllers/turfController"));
const authController_1 = __importDefault(require("./controllers/authController"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
const formatMonthKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
};
const formatMonthLabel = (date) => date.toLocaleString('en-US', { month: 'short' });
const buildMonthSeries = (months = 6) => {
    const series = [];
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
const parseSlotPrices = (value) => {
    if (!value)
        return {};
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return {};
        return Object.entries(parsed).reduce((acc, [slot, price]) => {
            const amount = Number(price);
            if (Number.isFinite(amount)) {
                acc[slot] = amount;
            }
            return acc;
        }, {});
    }
    catch {
        return {};
    }
};
const normalizeSlotLabel = (slot) => slot.replace(/\s*[-\u2013\u2014]\s*/, ' - ').trim();
const calculateBookingRevenue = (booking) => {
    const slotLabel = normalizeSlotLabel(`${booking.startTime} - ${booking.endTime}`);
    const slotPrices = parseSlotPrices(booking.turf.slotPrices);
    const slotPrice = slotPrices[slotLabel];
    if (Number.isFinite(slotPrice)) {
        return slotPrice;
    }
    return Number(booking.turf.pricePerHour || 0);
};
// Setup Rate Limiting
const limiter = (0, express_rate_limit_1.default)({
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
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
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
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use('/uploads', express_1.default.static(path_1.default.join(__dirname, '../uploads')));
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
            if (!monthBucket)
                continue;
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
    }
    catch (error) {
        console.error('Dashboard metrics error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard metrics' });
    }
});
// Routes
app.use('/api/bookings', bookingController_1.default);
app.use('/api/payments', paymentController_1.default);
app.use('/api/turfs', turfController_1.default);
app.use('/api/auth', authController_1.default);
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

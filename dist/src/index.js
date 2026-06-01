"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const client_1 = require("@prisma/client");
const bookingController_1 = __importDefault(require("./controllers/bookingController"));
const paymentController_1 = __importDefault(require("./controllers/paymentController"));
const turfController_1 = __importDefault(require("./controllers/turfController"));
const authController_1 = __importDefault(require("./controllers/authController"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Basic health check
app.get('/', (req, res) => {
    res.send('Kicko Backend is running!');
});
// Routes
app.use('/api/bookings', bookingController_1.default);
app.use('/api/payments', paymentController_1.default);
app.use('/api/turfs', turfController_1.default);
app.use('/api/auth', authController_1.default);
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

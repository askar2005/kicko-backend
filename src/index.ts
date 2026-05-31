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

// Setup Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
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

// Routes
app.use('/api/bookings', bookingController);
app.use('/api/payments', paymentController);
app.use('/api/turfs', turfController);
app.use('/api/auth', authController);

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

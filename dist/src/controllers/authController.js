"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const nodemailer_1 = __importDefault(require("nodemailer"));
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
// Nodemailer transporter
const transporter = nodemailer_1.default.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD
    }
});
// In-memory store for OTPs (for prototype purposes)
const otpStore = new Map();
// Generate and send OTP
router.post('/send-otp', async (req, res) => {
    try {
        const { email, name } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        // Generate 4-digit OTP
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        // Store OTP in memory for 5 minutes
        otpStore.set(email, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });
        // Send email
        await transporter.sendMail({
            from: `"Kicko Platform" <${process.env.SMTP_EMAIL}>`,
            to: email,
            subject: 'Kicko Verification Code',
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #0d9488;">Verify your email address</h2>
          <p>Hi ${name || 'there'},</p>
          <p>Thank you for registering on Kicko! Please use the following One-Time Password (OTP) to complete your registration:</p>
          <div style="background-color: #f3f4f6; padding: 15px; text-align: center; border-radius: 8px; margin: 20px 0;">
            <h1 style="letter-spacing: 5px; margin: 0; color: #1f2937;">${otp}</h1>
          </div>
          <p>This code will expire in 5 minutes.</p>
          <p>If you did not request this code, please ignore this email.</p>
        </div>
      `
        });
        res.json({ success: true, message: 'OTP sent successfully' });
    }
    catch (error) {
        console.error('Send OTP error:', error);
        res.status(500).json({ error: 'Failed to send OTP email' });
    }
});
// Verify OTP
router.post('/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) {
            return res.status(400).json({ error: 'Email and OTP are required' });
        }
        const storedData = otpStore.get(email);
        if (!storedData) {
            return res.status(400).json({ error: 'No OTP requested or OTP expired' });
        }
        if (Date.now() > storedData.expiresAt) {
            otpStore.delete(email);
            return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
        }
        if (storedData.otp !== otp) {
            return res.status(400).json({ error: 'Invalid OTP' });
        }
        // Success! Clear the OTP.
        otpStore.delete(email);
        res.json({ success: true, message: 'OTP verified successfully' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to verify OTP' });
    }
});
// Register a new customer
router.post('/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: 'An account with this email already exists. Please login instead.' });
        }
        // In a real app, hash the password using bcrypt. For this prototype, we store as-is.
        const user = await prisma.user.create({
            data: {
                name,
                email,
                phone: '1234567890' // Default dummy phone
            }
        });
        res.status(201).json({ id: user.id, name: user.name, email: user.email });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to register user' });
    }
});
// Login customer
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(401).json({ error: 'The email or password you entered is incorrect.' });
        }
        // In a real app, compare hashed passwords. Here we just assume success if email exists.
        res.json({ id: user.id, name: user.name, email: user.email });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to login' });
    }
});
// --- TURF OWNER AUTH ---
// Register Owner
router.post('/owner/register', async (req, res) => {
    try {
        const { name, email, password, phone } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }
        const existingOwner = await prisma.turfOwner.findUnique({ where: { email } });
        if (existingOwner) {
            return res.status(400).json({ error: 'An account with this email already exists. Please login instead.' });
        }
        const owner = await prisma.turfOwner.create({
            data: { name, email, password, phone }
        });
        res.status(201).json({ id: owner.id, name: owner.name, email: owner.email, mobile: owner.phone });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to register owner' });
    }
});
// Login Owner
router.post('/owner/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        const owner = await prisma.turfOwner.findUnique({ where: { email } });
        if (!owner || owner.password !== password) {
            return res.status(401).json({ error: 'The email or password you entered is incorrect.' });
        }
        res.json({ id: owner.id, name: owner.name, email: owner.email, mobile: owner.phone });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to login owner' });
    }
});
// --- ADMIN AUTH ---
// Register Admin
router.post('/admin/register', async (req, res) => {
    try {
        const { name, email, password, phone } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }
        const existingAdmin = await prisma.admin.findUnique({ where: { email } });
        if (existingAdmin) {
            return res.status(400).json({ error: 'An account with this email already exists. Please login instead.' });
        }
        const admin = await prisma.admin.create({
            data: { name, email, password, phone }
        });
        res.status(201).json({ id: admin.id, name: admin.name, email: admin.email, mobile: admin.phone });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to register admin' });
    }
});
// Login Admin
router.post('/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        const admin = await prisma.admin.findUnique({ where: { email } });
        if (!admin || admin.password !== password) {
            return res.status(401).json({ error: 'The email or password you entered is incorrect.' });
        }
        res.json({ id: admin.id, name: admin.name, email: admin.email, mobile: admin.phone });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to login admin' });
    }
});
exports.default = router;

import 'dotenv/config';
import { Request, Response, Router } from 'express';
import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const router = Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'kicko_jwt_secret_token_123_key';

// Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD
  }
});

// In-memory store for OTPs (for prototype purposes)
const otpStore = new Map<string, { otp: string, expiresAt: number }>();

// Generate and send OTP
router.post('/send-otp', async (req: Request, res: Response): Promise<any> => {
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
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({ error: 'Failed to send OTP email' });
  }
});

// Verify OTP
router.post('/verify-otp', async (req: Request, res: Response): Promise<any> => {
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
  } catch (error) {
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

// Register a new customer
router.post('/register', async (req: Request, res: Response): Promise<any> => {
  try {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'An account with this email already exists. Please login instead.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        phone: '1234567890' // Default dummy phone
      }
    });

    const token = jwt.sign({ id: user.id, email: user.email, role: 'customer' }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ token, id: user.id, name: user.name, email: user.email });
  } catch (error) {
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Login customer
router.post('/login', async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'The email or password you entered is incorrect.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'The email or password you entered is incorrect.' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: 'customer' }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ token, id: user.id, name: user.name, email: user.email });
  } catch (error) {
    res.status(500).json({ error: 'Failed to login' });
  }
});

// --- TURF OWNER AUTH ---
// Register Owner
router.post('/owner/register', async (req: Request, res: Response): Promise<any> => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    const existingOwner = await prisma.turfOwner.findUnique({ where: { email } });
    if (existingOwner) {
      return res.status(400).json({ error: 'An account with this email already exists. Please login instead.' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const owner = await prisma.turfOwner.create({
      data: { name, email, password: hashedPassword, phone }
    });
    const token = jwt.sign({ id: owner.id, email: owner.email, role: 'owner' }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, id: owner.id, name: owner.name, email: owner.email, mobile: owner.phone });
  } catch (error) {
    res.status(500).json({ error: 'Failed to register owner' });
  }
});

// Login Owner
router.post('/owner/login', async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const owner = await prisma.turfOwner.findUnique({ where: { email } });
    if (!owner) {
      return res.status(401).json({ error: 'The email or password you entered is incorrect.' });
    }
    const isMatch = await bcrypt.compare(password, owner.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'The email or password you entered is incorrect.' });
    }
    const token = jwt.sign({ id: owner.id, email: owner.email, role: 'owner' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, id: owner.id, name: owner.name, email: owner.email, mobile: owner.phone });
  } catch (error) {
    res.status(500).json({ error: 'Failed to login owner' });
  }
});

// --- ADMIN AUTH ---
// Register Admin
router.post('/admin/register', async (req: Request, res: Response): Promise<any> => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    const existingAdmin = await prisma.admin.findUnique({ where: { email } });
    if (existingAdmin) {
      return res.status(400).json({ error: 'An account with this email already exists. Please login instead.' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const admin = await prisma.admin.create({
      data: { name, email, password: hashedPassword, phone }
    });
    const token = jwt.sign({ id: admin.id, email: admin.email, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, id: admin.id, name: admin.name, email: admin.email, mobile: admin.phone });
  } catch (error) {
    res.status(500).json({ error: 'Failed to register admin' });
  }
});

// Login Admin
router.post('/admin/login', async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const admin = await prisma.admin.findUnique({ where: { email } });
    if (!admin) {
      return res.status(401).json({ error: 'The email or password you entered is incorrect.' });
    }
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'The email or password you entered is incorrect.' });
    }
    const token = jwt.sign({ id: admin.id, email: admin.email, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, id: admin.id, name: admin.name, email: admin.email, mobile: admin.phone });
  } catch (error) {
    res.status(500).json({ error: 'Failed to login admin' });
  }
});

// --- FORGOT PASSWORD ---
// Send OTP for password reset
router.post('/forgot-password/send-otp', async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, role } = req.body; // role can be 'customer', 'owner', 'admin'
    if (!email || !role) {
      return res.status(400).json({ error: 'Email and role are required' });
    }

    let userExists = false;
    let name = '';

    if (role === 'customer') {
      const u = await prisma.user.findUnique({ where: { email } });
      if (u) { userExists = true; name = u.name; }
    } else if (role === 'owner') {
      const o = await prisma.turfOwner.findUnique({ where: { email } });
      if (o) { userExists = true; name = o.name; }
    } else if (role === 'admin') {
      const a = await prisma.admin.findUnique({ where: { email } });
      if (a) { userExists = true; name = a.name; }
    }

    if (!userExists) {
      return res.status(404).json({ error: 'Account not found with this email' });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    otpStore.set(`reset_${email}`, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });

    await transporter.sendMail({
      from: `"Kicko Platform" <${process.env.SMTP_EMAIL}>`,
      to: email,
      subject: 'Kicko Password Reset Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #0d9488;">Reset your password</h2>
          <p>Hi ${name || 'there'},</p>
          <p>You requested a password reset. Please use the following code:</p>
          <div style="background-color: #f3f4f6; padding: 15px; text-align: center; border-radius: 8px; margin: 20px 0;">
            <h1 style="letter-spacing: 5px; margin: 0; color: #1f2937;">${otp}</h1>
          </div>
          <p>This code will expire in 5 minutes.</p>
          <p>If you did not request this, you can safely ignore this email.</p>
        </div>
      `
    });

    res.json({ success: true, message: 'Password reset OTP sent' });
  } catch (error) {
    console.error('Forgot password send OTP error:', error);
    res.status(500).json({ error: 'Failed to send reset OTP' });
  }
});

// Reset Password
router.post('/forgot-password/reset', async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, otp, newPassword, role } = req.body;
    if (!email || !otp || !newPassword || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const storedData = otpStore.get(`reset_${email}`);
    if (!storedData) {
      return res.status(400).json({ error: 'No OTP requested or OTP expired' });
    }
    
    if (Date.now() > storedData.expiresAt) {
      otpStore.delete(`reset_${email}`);
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    }
    
    if (storedData.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    if (role === 'customer') {
      await prisma.user.update({ where: { email }, data: { password: hashedPassword } });
    } else if (role === 'owner') {
      await prisma.turfOwner.update({ where: { email }, data: { password: hashedPassword } });
    } else if (role === 'admin') {
      await prisma.admin.update({ where: { email }, data: { password: hashedPassword } });
    }

    // Clear OTP
    otpStore.delete(`reset_${email}`);

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

export default router;

import 'dotenv/config';
import { Request, Response, Router } from 'express';
import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const router = Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'kicko_jwt_secret_token_123_key';
const isProduction = process.env.NODE_ENV === 'production';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD
  }
});

const otpStore = new Map<string, { otp: string; expiresAt: number }>();

type AuthRole = 'customer' | 'owner' | 'admin';

type AuthEntity = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
};

const normalizeEmail = (email: unknown) => String(email || '').trim().toLowerCase();
const normalizeText = (value: unknown) => String(value || '').trim();

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const generateOtp = () => Math.floor(1000 + Math.random() * 9000).toString();

const signToken = (entity: AuthEntity, role: AuthRole) =>
  jwt.sign({ id: entity.id, email: entity.email, role }, JWT_SECRET, { expiresIn: '7d' });

const authPayload = (entity: AuthEntity, role: AuthRole) => {
  const token = signToken(entity, role);
  return {
    success: true,
    token,
    id: entity.id,
    name: entity.name,
    email: entity.email,
    phone: entity.phone || undefined,
    mobile: entity.phone || undefined,
    role,
    user: {
      id: entity.id,
      name: entity.name,
      email: entity.email,
      phone: entity.phone || undefined,
      mobile: entity.phone || undefined,
      role
    }
  };
};

const sendOtpEmail = async (email: string, subject: string, html: string) => {
  if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
    throw new Error('SMTP is not configured');
  }

  await transporter.sendMail({
    from: `"Kicko Platform" <${process.env.SMTP_EMAIL}>`,
    to: email,
    subject,
    html
  });
};

const otpEmailHtml = (name: string, otp: string) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #0d9488;">Verify your email address</h2>
    <p>Hi ${name || 'there'},</p>
    <p>Thank you for registering on Kicko. Use this One-Time Password to complete registration:</p>
    <div style="background-color: #f3f4f6; padding: 15px; text-align: center; border-radius: 8px; margin: 20px 0;">
      <h1 style="letter-spacing: 5px; margin: 0; color: #1f2937;">${otp}</h1>
    </div>
    <p>This code will expire in 5 minutes.</p>
  </div>
`;

const resetEmailHtml = (name: string, otp: string) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #0d9488;">Reset your password</h2>
    <p>Hi ${name || 'there'},</p>
    <p>You requested a password reset. Use this code:</p>
    <div style="background-color: #f3f4f6; padding: 15px; text-align: center; border-radius: 8px; margin: 20px 0;">
      <h1 style="letter-spacing: 5px; margin: 0; color: #1f2937;">${otp}</h1>
    </div>
    <p>This code will expire in 5 minutes.</p>
  </div>
`;

const safeServerError = (res: Response, message: string, error: unknown) => {
  console.error(message, error);
  return res.status(500).json({ success: false, error: message });
};

router.post('/send-otp', async (req: Request, res: Response): Promise<any> => {
  try {
    const email = normalizeEmail(req.body.email);
    const name = normalizeText(req.body.name);

    if (!email) return res.status(400).json({ success: false, error: 'Email is required' });
    if (!isValidEmail(email)) return res.status(400).json({ success: false, error: 'Please enter a valid email address' });

    const otp = generateOtp();
    otpStore.set(email, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });

    await sendOtpEmail(email, 'Kicko Verification Code', otpEmailHtml(name, otp));

    res.json({
      success: true,
      message: 'OTP sent successfully',
      ...(!isProduction ? { devOtp: otp } : {})
    });
  } catch (error) {
    return safeServerError(res, 'Failed to send OTP email', error);
  }
});

router.post('/verify-otp', async (req: Request, res: Response): Promise<any> => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = normalizeText(req.body.otp);

    if (!email || !otp) return res.status(400).json({ success: false, error: 'Email and OTP are required' });

    const storedData = otpStore.get(email);
    if (!storedData) return res.status(400).json({ success: false, error: 'No OTP requested or OTP expired' });

    if (Date.now() > storedData.expiresAt) {
      otpStore.delete(email);
      return res.status(400).json({ success: false, error: 'OTP has expired. Please request a new one.' });
    }

    if (storedData.otp !== otp) return res.status(400).json({ success: false, error: 'Invalid OTP' });

    otpStore.delete(email);
    res.json({ success: true, message: 'OTP verified successfully' });
  } catch (error) {
    return safeServerError(res, 'Failed to verify OTP', error);
  }
});

router.post('/register', async (req: Request, res: Response): Promise<any> => {
  try {
    const name = normalizeText(req.body.name);
    const email = normalizeEmail(req.body.email);
    const password = normalizeText(req.body.password);
    const phone = normalizeText(req.body.phone) || '1234567890';

    if (!name || !email || !password) return res.status(400).json({ success: false, error: 'Name, email, and password are required' });
    if (!isValidEmail(email)) return res.status(400).json({ success: false, error: 'Please enter a valid email address' });
    if (password.length < 6) return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return res.status(409).json({ success: false, error: 'An account with this email already exists. Please login instead.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { name, email, password: hashedPassword, phone } });

    res.status(201).json(authPayload(user, 'customer'));
  } catch (error: any) {
    if (error?.code === 'P2002') return res.status(409).json({ success: false, error: 'An account with this email already exists. Please login instead.' });
    return safeServerError(res, 'Failed to register user', error);
  }
});

router.post('/login', async (req: Request, res: Response): Promise<any> => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = normalizeText(req.body.password);

    if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password are required' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ success: false, error: 'The email or password you entered is incorrect.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ success: false, error: 'The email or password you entered is incorrect.' });

    res.json(authPayload(user, 'customer'));
  } catch (error) {
    return safeServerError(res, 'Failed to login', error);
  }
});

router.post('/owner/register', async (req: Request, res: Response): Promise<any> => {
  try {
    const name = normalizeText(req.body.name);
    const email = normalizeEmail(req.body.email);
    const password = normalizeText(req.body.password);
    const phone = normalizeText(req.body.phone);

    if (!name || !email || !password) return res.status(400).json({ success: false, error: 'Name, email, and password are required' });
    if (!isValidEmail(email)) return res.status(400).json({ success: false, error: 'Please enter a valid email address' });
    if (password.length < 6) return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });

    const existingOwner = await prisma.turfOwner.findUnique({ where: { email } });
    if (existingOwner) return res.status(409).json({ success: false, error: 'An account with this email already exists. Please login instead.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const owner = await prisma.turfOwner.create({ data: { name, email, password: hashedPassword, phone: phone || null } });

    res.status(201).json(authPayload(owner, 'owner'));
  } catch (error: any) {
    if (error?.code === 'P2002') return res.status(409).json({ success: false, error: 'An account with this email already exists. Please login instead.' });
    return safeServerError(res, 'Failed to register owner', error);
  }
});

router.post('/owner/login', async (req: Request, res: Response): Promise<any> => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = normalizeText(req.body.password);

    if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password are required' });

    const owner = await prisma.turfOwner.findUnique({ where: { email } });
    if (!owner) return res.status(401).json({ success: false, error: 'The email or password you entered is incorrect.' });

    const isMatch = await bcrypt.compare(password, owner.password);
    if (!isMatch) return res.status(401).json({ success: false, error: 'The email or password you entered is incorrect.' });

    res.json(authPayload(owner, 'owner'));
  } catch (error) {
    return safeServerError(res, 'Failed to login owner', error);
  }
});

router.post('/admin/register', async (req: Request, res: Response): Promise<any> => {
  try {
    const name = normalizeText(req.body.name);
    const email = normalizeEmail(req.body.email);
    const password = normalizeText(req.body.password);
    const phone = normalizeText(req.body.phone);

    if (!name || !email || !password) return res.status(400).json({ success: false, error: 'Name, email, and password are required' });
    if (!isValidEmail(email)) return res.status(400).json({ success: false, error: 'Please enter a valid email address' });
    if (password.length < 6) return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });

    const existingAdmin = await prisma.admin.findUnique({ where: { email } });
    if (existingAdmin) return res.status(409).json({ success: false, error: 'An account with this email already exists. Please login instead.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const admin = await prisma.admin.create({ data: { name, email, password: hashedPassword, phone: phone || null } });

    res.status(201).json(authPayload(admin, 'admin'));
  } catch (error: any) {
    if (error?.code === 'P2002') return res.status(409).json({ success: false, error: 'An account with this email already exists. Please login instead.' });
    return safeServerError(res, 'Failed to register admin', error);
  }
});

router.post('/admin/login', async (req: Request, res: Response): Promise<any> => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = normalizeText(req.body.password);

    if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password are required' });

    const admin = await prisma.admin.findUnique({ where: { email } });
    if (!admin) return res.status(401).json({ success: false, error: 'The email or password you entered is incorrect.' });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(401).json({ success: false, error: 'The email or password you entered is incorrect.' });

    res.json(authPayload(admin, 'admin'));
  } catch (error) {
    return safeServerError(res, 'Failed to login admin', error);
  }
});

router.post('/forgot-password/send-otp', async (req: Request, res: Response): Promise<any> => {
  try {
    const email = normalizeEmail(req.body.email);
    const role = normalizeText(req.body.role) as AuthRole;

    if (!email || !role) return res.status(400).json({ success: false, error: 'Email and role are required' });
    if (!['customer', 'owner', 'admin'].includes(role)) return res.status(400).json({ success: false, error: 'Invalid role' });

    let account: AuthEntity | null = null;
    if (role === 'customer') account = await prisma.user.findUnique({ where: { email } });
    if (role === 'owner') account = await prisma.turfOwner.findUnique({ where: { email } });
    if (role === 'admin') account = await prisma.admin.findUnique({ where: { email } });

    if (!account) return res.status(404).json({ success: false, error: 'Account not found with this email' });

    const otp = generateOtp();
    otpStore.set(`reset_${email}`, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });

    await sendOtpEmail(email, 'Kicko Password Reset Code', resetEmailHtml(account.name, otp));

    res.json({
      success: true,
      message: 'Password reset OTP sent',
      ...(!isProduction ? { devOtp: otp } : {})
    });
  } catch (error) {
    return safeServerError(res, 'Failed to send reset OTP', error);
  }
});

router.post('/forgot-password/reset', async (req: Request, res: Response): Promise<any> => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = normalizeText(req.body.otp);
    const newPassword = normalizeText(req.body.newPassword);
    const role = normalizeText(req.body.role) as AuthRole;

    if (!email || !otp || !newPassword || !role) return res.status(400).json({ success: false, error: 'Missing required fields' });
    if (!['customer', 'owner', 'admin'].includes(role)) return res.status(400).json({ success: false, error: 'Invalid role' });
    if (newPassword.length < 6) return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });

    const storedData = otpStore.get(`reset_${email}`);
    if (!storedData) return res.status(400).json({ success: false, error: 'No OTP requested or OTP expired' });

    if (Date.now() > storedData.expiresAt) {
      otpStore.delete(`reset_${email}`);
      return res.status(400).json({ success: false, error: 'OTP has expired. Please request a new one.' });
    }

    if (storedData.otp !== otp) return res.status(400).json({ success: false, error: 'Invalid OTP' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    if (role === 'customer') await prisma.user.update({ where: { email }, data: { password: hashedPassword } });
    if (role === 'owner') await prisma.turfOwner.update({ where: { email }, data: { password: hashedPassword } });
    if (role === 'admin') await prisma.admin.update({ where: { email }, data: { password: hashedPassword } });

    otpStore.delete(`reset_${email}`);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    return safeServerError(res, 'Failed to reset password', error);
  }
});

export default router;

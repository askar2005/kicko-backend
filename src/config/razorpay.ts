import 'dotenv/config';
import Razorpay from 'razorpay';

const key_id = process.env.RAZORPAY_KEY_ID;
const key_secret = process.env.RAZORPAY_KEY_SECRET;

if (!key_id || !key_secret) {
  throw new Error('Missing Razorpay credentials in environment variables');
}

export const razorpayClient = new Razorpay({
  key_id,
  key_secret
});

export const razorpayKeyId = key_id;

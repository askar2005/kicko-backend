import brevoClient from '../config/brevo';

export type SendEmailOptions = {
  to: string;
  subject: string;
  html: string;
  recipientName?: string;
};

export const sendTransactionalEmail = async ({
  to,
  subject,
  html,
  recipientName,
}: SendEmailOptions): Promise<void> => {
  await brevoClient.transactionalEmails.sendTransacEmail({
    sender: {
      name: 'Kicko Platform',
      email: process.env.SENDER_EMAIL!,
    },
    to: [{ email: to, name: recipientName || to }],
    subject,
    htmlContent: html,
  });
};

export const otpEmailHtml = (name: string, otp: string) => `
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

export const resetEmailHtml = (name: string, otp: string) => `
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

export const sendOtpEmail = async (
  email: string,
  subject: string,
  html: string,
  recipientName?: string
) => sendTransactionalEmail({ to: email, subject, html, recipientName });

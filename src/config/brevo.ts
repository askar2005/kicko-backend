import 'dotenv/config';
import { BrevoClient } from '@getbrevo/brevo';

const validateEmailConfig = (): void => {
  const missing: string[] = [];

  if (!process.env.BREVO_API_KEY?.trim()) {
    missing.push('BREVO_API_KEY');
  }

  if (!process.env.SENDER_EMAIL?.trim()) {
    missing.push('SENDER_EMAIL');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required email configuration: ${missing.join(', ')}. ` +
        'Set these environment variables before starting the server. ' +
        'SENDER_EMAIL must be an email address verified in your Brevo account ' +
        '(Senders & IP → Senders).'
    );
  }
};

validateEmailConfig();

const brevoClient = new BrevoClient({
  apiKey: process.env.BREVO_API_KEY!.trim(),
});

export default brevoClient;

import 'dotenv/config';
import { BrevoClient } from '@getbrevo/brevo';

const apiKey = process.env.BREVO_API_KEY;

if (!apiKey) {
  console.warn('BREVO_API_KEY is not set. Transactional emails will fail until it is configured.');
}

const brevoClient = new BrevoClient({
  apiKey: apiKey ?? '',
});

export default brevoClient;

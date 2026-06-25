import { z } from 'zod';

export const CHANNELS = ['app', 'sms', 'call_center', 'merchant_portal'];

export const LOCALES = ['bn', 'en', 'mixed'];

const MESSAGE_MAX = 4000;

export const sortTicketRequestSchema = z.object({
  ticket_id: z.string().min(1, 'ticket_id must not be empty'),
  channel: z.enum(CHANNELS).optional(),
  locale: z.enum(LOCALES).optional(),
  message: z
    .string()
    .min(1, 'message must not be empty')
    .max(MESSAGE_MAX, `message must be <= ${MESSAGE_MAX} characters`),
});

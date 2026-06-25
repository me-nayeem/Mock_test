import { z } from 'zod';

export const CASE_TYPES = [
  'wrong_transfer',
  'payment_failed',
  'refund_request',
  'phishing_or_social_engineering',
  'other',
];

export const DEPARTMENTS = ['customer_support', 'dispute_resolution', 'payments_ops', 'fraud_risk'];

export const SEVERITIES = ['low', 'medium', 'high', 'critical'];

export const sortTicketResponseSchema = z.object({
  ticket_id: z.string().min(1),

  case_type: z.enum(CASE_TYPES),
  severity: z.enum(SEVERITIES),
  department: z.enum(DEPARTMENTS),
  agent_summary: z.string().min(1).max(500),

  human_review_required: z.boolean(),
  confidence: z.number().min(0).max(1),
});

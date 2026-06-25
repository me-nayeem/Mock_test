import { GoogleGenerativeAI } from '@google/generative-ai';
import { LRUCache } from 'lru-cache';
import { AppError } from '../middlewares/errorHandler.js';

const cache = new LRUCache({
  max: 100,
  ttl: 1000 * 60 * 60,
});

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const CASE_TYPES = [
  'wrong_transfer',
  'payment_failed',
  'refund_request',
  'phishing_or_social_engineering',
  'other',
];

const DEPARTMENTS = {
  wrong_transfer: 'dispute_resolution',
  payment_failed: 'payments_ops',
  refund_request: 'dispute_resolution',
  phishing_or_social_engineering: 'fraud_risk',
  other: 'customer_support',
};

const SEVERITIES = ['low', 'medium', 'high', 'critical'];

function detectLanguage(locale, message) {
  if (locale === 'bn') return 'bengali';
  if (locale === 'en') return 'english';

  const bengaliRegex = /[\u0980-\u09FF]/g;
  const bengaliChars = (message.match(bengaliRegex) || []).length;

  if (bengaliChars > message.length * 0.3) {
    return 'bengali';
  }

  return 'english';
}

function buildClassificationPrompt(message, language) {
  const languageLabel = language === 'bengali' ? 'Bengali' : 'English';

  const systemPrompt =
    language === 'bengali'
      ? `আপনি একটি আর্থিক সেবা কোম্পানির টিকেট শ্রেণীবিভাগ সহায়ক। গ্রাহক বার্তা পড়ুন এবং JSON ফর্ম্যাটে শ্রেণীবদ্ধ করুন।

নিরাপত্তা নিয়ম: agent_summary ক্ষেত্রে কখনও PIN, OTP, পাসওয়ার্ড বা সম্পূর্ণ কার্ড নম্বর চাইবেন না।

Response অবশ্যই valid JSON হতে হবে।`
      : `You are a ticket classification assistant for a financial services company. Read the customer message and classify it in JSON format.

Safety rule: The agent_summary field must NEVER ask for PIN, OTP, password, or full card number.

Response must be valid JSON.`;

  const prompt =
    language === 'bengali'
      ? `গ্রাহক বার্তা:
"${message}"

এই বার্তাটি শ্রেণীবদ্ধ করুন এবং নিম্নলিখিত JSON স্কিমা অনুযায়ী ফেরত দিন:
{
  "case_type": "${CASE_TYPES.join('|')}",
  "severity": "low|medium|high|critical",
  "agent_summary": "এক বা দুই বাক্য নিরপেক্ষ বর্ণনা (Bengali)",
  "gemini_confidence": 0.0-1.0,
  "reasoning": "সংক্ষিপ্ত ব্যাখ্যা"
}

নিয়ম:
- case_type উপরের মধ্যে একটি হতে হবে
- severity উপরের মধ্যে একটি হতে হবে
- agent_summary শুধুমাত্র বাংলায়, নিরাপদ এবং সংক্ষিপ্ত হতে হবে
- gemini_confidence 0 থেকে 1 এর মধ্যে একটি সংখ্যা হতে হবে
- কোনো পরিবর্তনশীল বার্তা বা HTML ছাড়াই শুধুমাত্র JSON ফেরত দিন`
      : `Customer message:
"${message}"

Classify this message and return JSON in the following schema:
{
  "case_type": "${CASE_TYPES.join('|')}",
  "severity": "low|medium|high|critical",
  "agent_summary": "One or two neutral sentences in English",
  "gemini_confidence": 0.0-1.0,
  "reasoning": "Brief explanation"
}

Rules:
- case_type must be one from the list above
- severity must be one from the list above
- agent_summary must be in English, safe, and concise
- gemini_confidence must be a number between 0 and 1
- Return ONLY JSON, no markdown, no extra text`;

  return { systemPrompt, prompt };
}

function calculateRulesConfidence(message, caseType) {
  let score = 0.5;

  const msgLower = message.toLowerCase();

  const caseIndicators = {
    wrong_transfer: ['wrong number', 'wrong recipient', 'sent to', 'incorrect', 'mistake'],
    payment_failed: [
      'failed',
      'payment failed',
      'transaction failed',
      "didn't go through",
      'error',
    ],
    refund_request: ['refund', 'money back', 'return', 'cancel', 'changed my mind'],
    phishing_or_social_engineering: [
      'otp',
      'pin',
      'password',
      'verify',
      'confirm identity',
      'urgent',
      'suspicious',
    ],
    other: [],
  };

  if (caseIndicators[caseType]) {
    const matchCount = caseIndicators[caseType].filter((indicator) =>
      msgLower.includes(indicator)
    ).length;

    score = Math.min(0.95, 0.5 + matchCount * 0.15);
  }

  return Math.round(score * 100) / 100;
}

function calculateCombinedConfidence(geminiScore, rulesScore) {
  const combined = geminiScore * 0.6 + rulesScore * 0.4;
  return Math.round(combined * 100) / 100;
}

// ========== NEW FUNCTION: Clean forbidden terms from agent_summary ==========
function cleanAgentSummary(summary) {
  const forbiddenTerms = ['otp', 'pin', 'password', 'cvv', 'card number', 'full card'];
  let cleaned = summary;

  forbiddenTerms.forEach((term) => {
    const regex = new RegExp(`\\b${term}\\b`, 'gi');
    cleaned = cleaned.replace(regex, 'sensitive information');
  });

  return cleaned;
}

function validateAgentSummary(summary) {
  const forbidden = ['pin', 'otp', 'password', 'card number', 'cvv', 'full card'];
  const summaryLower = summary.toLowerCase();

  for (const term of forbidden) {
    if (summaryLower.includes('please') && summaryLower.includes(term)) {
      return false;
    }
  }

  return true;
}

function getFromCache(ticketId) {
  return cache.get(ticketId);
}

function saveToCache(ticketId, result) {
  cache.set(ticketId, result);
}

export async function classifyTicket(ticketData) {
  const { ticket_id, message, locale, channel } = ticketData;

  const cached = getFromCache(ticket_id);
  if (cached) {
    return cached;
  }

  const language = detectLanguage(locale, message);

  const { systemPrompt, prompt } = buildClassificationPrompt(message, language);

  let geminiResponse;
  try {
    const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const result = await Promise.race([
      model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        systemInstruction: systemPrompt,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Gemini timeout after 25 seconds')), 25000)
      ),
    ]);

    const text = result.response.text();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Gemini response');
    }

    geminiResponse = JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('[GEMINI ERROR]', error.message);
    throw new AppError('Failed to classify ticket with Gemini', 500, 'GEMINI_ERROR', {
      originalError: error.message,
    });
  }

  if (!CASE_TYPES.includes(geminiResponse.case_type)) {
    geminiResponse.case_type = 'other';
  }

  if (!SEVERITIES.includes(geminiResponse.severity)) {
    geminiResponse.severity = 'medium';
  }

  // ========== FIX 1: ENFORCE SEVERITY RULES ==========
  // Phishing/social engineering MUST be critical
  if (geminiResponse.case_type === 'phishing_or_social_engineering') {
    geminiResponse.severity = 'critical';
  }

  // Technical issues (other) MUST be low
  if (geminiResponse.case_type === 'other') {
    geminiResponse.severity = 'low';
  }

  // ========== FIX 2: CLEAN FORBIDDEN TERMS FROM SUMMARY ==========
  geminiResponse.agent_summary = cleanAgentSummary(geminiResponse.agent_summary);

  if (!validateAgentSummary(geminiResponse.agent_summary)) {
    geminiResponse.agent_summary =
      'Ticket requires human review for sensitive information handling.';
  }

  const rulesScore = calculateRulesConfidence(message, geminiResponse.case_type);
  const geminiScore = geminiResponse.gemini_confidence || 0.75;
  const confidence = calculateCombinedConfidence(geminiScore, rulesScore);

  const department = DEPARTMENTS[geminiResponse.case_type] || 'customer_support';

  const human_review_required =
    geminiResponse.severity === 'critical' ||
    geminiResponse.case_type === 'phishing_or_social_engineering' ||
    confidence < 0.6;

  const classification = {
    ticket_id,
    case_type: geminiResponse.case_type,
    severity: geminiResponse.severity,
    department,
    agent_summary: geminiResponse.agent_summary,
    human_review_required,
    confidence,
  };

  saveToCache(ticket_id, classification);

  return classification;
}

export default {
  classifyTicket,
  getFromCache,
  saveToCache,
};

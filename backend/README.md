# Ticket Classification Backend

A lightweight Express backend for classifying customer support tickets using Google Gemini generative AI. The project validates incoming ticket payloads, sends the message to a classification model, sanitizes the response, and returns a structured routing decision.

## Features

- Express server with JSON body parsing, security headers, and CORS
- Request validation using Zod
- Ticket classification via Google Gemini generative AI
- Response schema validation to ensure safe API output
- LRU cache for repeated ticket lookups
- Centralized error handling and 404 catch-all
- Health endpoint for basic readiness checks

## Tech stack

- Node.js
- Express 5
- Zod
- Google Generative AI (`@google/generative-ai`)
- Helmet
- CORS
- LRU cache
- Vitest + Supertest for testing support
- Prettier for formatting

## Requirements

- Node.js 18+ (or compatible version supporting ES modules)
- npm
- A Google Gemini API key set in `GEMINI_API_KEY`

## Installation

1. Clone or copy the repository into `d:\Ecom\Mock_test\backend`
2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the project root with the required environment variables.

## Environment variables

Create a `.env` file with:

```dotenv
PORT=3000
GEMINI_API_KEY=your_gemini_api_key_here
CACHE_TTL_S=3600
```

- `PORT` - port number the server listens on (default: `3000`)
- `GEMINI_API_KEY` - required API key for Google Gemini requests
- `CACHE_TTL_S` - optional cache TTL in seconds for classification results

## Configuration

The app configuration is loaded from `src/config.js` and supports:

- `port`
- `geminiKey`
- `cacheTtlS`
- `llmMinConfidence`
- `llmOverrideMin`
- `cacheMaxEntries`

## Running the app

Start in production mode:

```bash
npm start
```

Start in development mode with file watching:

```bash
npm run dev
```

## API Endpoints

### Health check

`GET /health`

Response:

```json
{
  "status": "ok",
  "uptime": 123.456,
  "timestamp": "2026-06-26T00:00:00.000Z"
}
```

### Ticket classification

`POST /sort-ticket`

Validates and classifies the incoming ticket request.

#### Request body

```json
{
  "ticket_id": "string",
  "message": "string",
  "channel": "app" | "sms" | "call_center" | "merchant_portal",
  "locale": "bn" | "en" | "mixed"
}
```

- `ticket_id` - required, non-empty string
- `message` - required, non-empty string up to 4000 characters
- `channel` - optional, one of the supported channel values
- `locale` - optional, one of the supported locale values

#### Successful response

```json
{
  "ticket_id": "123",
  "case_type": "wrong_transfer",
  "severity": "medium",
  "department": "dispute_resolution",
  "agent_summary": "Customer reported a payment sent to the wrong recipient.",
  "human_review_required": false,
  "confidence": 0.82
}
```

#### Response fields

- `ticket_id` - echoes the incoming ticket ID
- `case_type` - one of:
  - `wrong_transfer`
  - `payment_failed`
  - `refund_request`
  - `phishing_or_social_engineering`
  - `other`
- `severity` - one of: `low`, `medium`, `high`, `critical`
- `department` - derived routing department:
  - `customer_support`
  - `dispute_resolution`
  - `payments_ops`
  - `fraud_risk`
- `agent_summary` - short safe summary intended for agents
- `human_review_required` - boolean indicating whether escalation is needed
- `confidence` - combined confidence score between `0` and `1`

## Validation and error handling

- Request payload validation is handled by `src/middlewares/validate.js`
- Response validation is enforced in `src/controllers/ticket.controller.js`
- Errors are formatted by `src/middlewares/errorHandler.js`
- Unknown routes return a 404 error via `notFoundHandler`

## Classification logic

The ticket classifier in `src/services/ticket.service.js`:

- detects the language from `locale` and message content
- builds a Gemini prompt for English or Bengali
- sends the prompt to `gemini-2.5-flash`
- parses JSON from the model response
- enforces valid `case_type` and `severity` values
- sanitizes the summary to avoid sensitive data terms
- calculates a combined confidence score using model output and heuristic rules
- determines whether `human_review_required` should be true
- caches results by `ticket_id`

## Folder structure

```text
src/
  config.js
  server.js
  controllers/
    ticket.controller.js
  middlewares/
    errorHandler.js
    validate.js
  routes/
    health.route.js
    tickets.route.js
  schemas/
    request.schema.js
    response.schema.js
  services/
    ticket.service.js
  utils/
    apiResponse.js
```

## Development helpers

- `npm test` - run unit and integration tests with Vitest
- `npm run test:watch` - run tests in watch mode
- `npm run format` - format all files with Prettier
- `npm run format:check` - check formatting
- `npm run format:src` - format source files only

## Notes

- A valid `GEMINI_API_KEY` is required for classification to work.
- The service is designed to clean and validate AI-generated responses before returning them.
- If Gemini does not return valid JSON or the response cannot be parsed, the endpoint returns a structured error.

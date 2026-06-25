import express from 'express';
import helmet from 'helmet';
import cors from 'cors';

import { config } from './config.js';
import healthRouter from './routes/health.route.js';
import ticketsRouter from './routes/tickets.route.js';
import { globalErrorHandler, notFoundHandler } from './middlewares/errorHandler.js';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '32kb' }));

// Routes
app.use(healthRouter);
app.use(ticketsRouter);

// 404
app.use(notFoundHandler);
app.use(globalErrorHandler);

const server = app.listen(config.port, () => {
  console.log(`listening on :${config.port}`);
});

const shutdown = (sig) => {
  console.log(`[queue-storm] ${sig} received, closing...`);
  server.close(() => process.exit(0));
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default app;

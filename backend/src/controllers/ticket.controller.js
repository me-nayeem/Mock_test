import { classifyTicket } from '../services/ticket.service.js';
import { sortTicketResponseSchema } from '../schemas/response.schema.js';
import { AppError } from '../middlewares/errorHandler.js';

async function sortTicket(req, res, next) {
  try {
    const ticketData = req.body;

    const classification = await classifyTicket(ticketData);

    const validation = sortTicketResponseSchema.safeParse(classification);

    if (!validation.success) {
      console.error('[RESPONSE VALIDATION ERROR]', validation.error.issues);
      return next(
        new AppError(
          'Internal error: Response validation failed',
          500,
          'RESPONSE_VALIDATION_ERROR',
          validation.error.issues
        )
      );
    }

    return res.status(200).json(validation.data);
  } catch (error) {
    console.error('[CONTROLLER ERROR]', error.message);
    return next(error);
  }
}

export default sortTicket;

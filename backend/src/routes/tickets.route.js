import { Router } from 'express';
import sortTicket from '../controllers/ticket.controller.js';
import { validateBody } from '../middlewares/validate.js';
import { sortTicketRequestSchema } from '../schemas/request.schema.js';

const router = Router();

router.post('/sort-ticket', validateBody(sortTicketRequestSchema), sortTicket);

export default router;

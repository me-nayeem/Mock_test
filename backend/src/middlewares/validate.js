import { AppError } from '../middlewares/errorHandler.js';

export const validateBody = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
      code: i.code,
    }));

    return next(new AppError('Request body failed validation', 400, 'VALIDATION_ERROR', issues));
  }

  req.body = result.data;
  return next();
};

import { Router } from 'express';
import { invalid } from '../lib/errors.js';
import { isDate } from '../lib/time.js';
import { requirePasswordCurrent, requirePermission, requireSession } from '../middleware/auth.js';
import { availabilityFor } from '../schedule/availability.js';

export function availabilityRouter(): Router {
  const router = Router();
  router.use(requireSession, requirePasswordCurrent, requirePermission('bookings.manage'));

  router.get('/', async (req, res) => {
    const { date } = req.query;
    if (!isDate(date)) throw invalid('Choose a valid date.');
    res.json(await availabilityFor(date));
  });

  return router;
}

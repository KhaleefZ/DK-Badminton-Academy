import { Router } from 'express';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { can } from '../auth/permissions.js';
import { db } from '../db/client.js';
import { bookings, customers, enquiries, memberships, payments } from '../db/schema.js';
import { customerMatches, likeTerm } from '../lib/search.js';
import { currentAuth, requirePasswordCurrent, requireSession } from '../middleware/auth.js';
import { bookingSearch, bookingViews } from './bookings.js';

const LIMIT = 8;

export function searchRouter(): Router {
  const router = Router();
  router.use(requireSession, requirePasswordCurrent);

  router.get('/', async (req, res) => {
    const q = String(req.query.q ?? '').trim().slice(0, 100);
    if (!q) {
      res.json({ customers: [], bookings: [], receipts: [], enquiries: [], memberships: [] });
      return;
    }
    const role = currentAuth(req).staff.role;
    const [customerRows, bookingRows, receiptRows, enquiryRows, membershipRows] = await Promise.all([
      db.select().from(customers).where(and(isNull(customers.deletedAt), customerMatches(q))).orderBy(desc(customers.createdAt)).limit(LIMIT),
      bookingViews(bookingSearch(q), 50),
      can(role, 'payments.view')
        ? db
            .select({ id: payments.id, receiptNo: payments.receiptNo, amountPaise: payments.amountPaise, bookingNo: bookings.bookingNo })
            .from(payments)
            .leftJoin(bookings, eq(payments.bookingId, bookings.id))
            .where(sql`${payments.receiptNo} ILIKE ${likeTerm(q)}`)
            .limit(LIMIT)
        : [],
      db
        .select({ id: enquiries.id, enquiryNo: enquiries.enquiryNo, name: enquiries.name, topic: enquiries.topic })
        .from(enquiries)
        .where(sql`(${enquiries.enquiryNo} ILIKE ${likeTerm(q)} OR ${enquiries.name} ILIKE ${likeTerm(q)} OR ${enquiries.email} ILIKE ${likeTerm(q)} OR ${enquiries.phone} ILIKE ${likeTerm(q)} OR ${enquiries.message} ILIKE ${likeTerm(q)})`)
        .orderBy(desc(enquiries.createdAt))
        .limit(LIMIT),
      db
        .select({ id: memberships.id, membershipNo: memberships.membershipNo, holderName: memberships.holderName, endsOn: memberships.endsOn })
        .from(memberships)
        .where(
          and(
            isNull(memberships.deletedAt),
            sql`(${memberships.membershipNo} ILIKE ${likeTerm(q)} OR ${memberships.holderName} ILIKE ${likeTerm(q)} OR ${memberships.email} ILIKE ${likeTerm(q)} OR ${memberships.notes} ILIKE ${likeTerm(q)} OR regexp_replace(${memberships.phone}, '[^0-9]', '', 'g') LIKE ${likeTerm(q.replace(/\D/g, '') || q)})`,
          ),
        )
        .orderBy(desc(memberships.createdAt))
        .limit(LIMIT),
    ]);
    // Newest bookings are the likeliest match, and the shared query returns them oldest first.
    res.json({ customers: customerRows, bookings: bookingRows.reverse().slice(0, LIMIT), receipts: receiptRows, enquiries: enquiryRows, memberships: membershipRows });
  });

  return router;
}

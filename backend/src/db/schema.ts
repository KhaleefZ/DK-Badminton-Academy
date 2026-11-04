import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { bigserial, boolean, check, customType, date, index, integer, jsonb, pgEnum, pgSequence, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const staffRole = pgEnum('staff_role', ['owner', 'manager', 'front_desk']);
export const staffStatus = pgEnum('staff_status', ['active', 'inactive']);
export const reservationKind = pgEnum('reservation_kind', ['booking', 'member_block', 'staff_block']);
export const reservationStatus = pgEnum('reservation_status', ['active', 'released']);
export const customerType = pgEnum('customer_type', ['walk_in', 'website']);
export const bookingStatus = pgEnum('booking_status', ['active', 'cancelled', 'pending_payment', 'expired']);
export const bookingSource = pgEnum('booking_source', ['admin', 'website']);
export const paymentMethod = pgEnum('payment_method', ['cash', 'upi', 'online_test'])
export const enquiryStatus = pgEnum('enquiry_status', ['new', 'handled'])
export const membershipKind = pgEnum('membership_kind', ['individual', 'court']);
export const membershipStatus = pgEnum('membership_status', ['active', 'cancelled', 'pending_payment', 'expired']);
export const discountType = pgEnum('discount_type', ['percent', 'fixed']);
export const messageChannel = pgEnum('message_channel', ['email', 'whatsapp']);
export const messageStatus = pgEnum('message_status', ['queued', 'sending', 'sent', 'failed', 'expired', 'cancelled']);;

// Staff numbers come from a sequence so a number is never reused, even after a delete.
export const staffNumberSeq = pgSequence('staff_number_seq');
export const walkInNumberSeq = pgSequence('walk_in_number_seq');
export const websiteNumberSeq = pgSequence('website_number_seq');
export const bookingNumberSeq = pgSequence('booking_number_seq');
export const receiptNumberSeq = pgSequence('receipt_number_seq');
export const enquiryNumberSeq = pgSequence('enquiry_number_seq');
export const individualNumberSeq = pgSequence('individual_member_number_seq');
export const courtMemberNumberSeq = pgSequence('court_member_number_seq');

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Admin accounts. Two database triggers (see the migration) enforce the rules that must hold
 * however a row is changed: at most 5 active accounts, and always one active Owner.
 */
export const staff = pgTable(
  'staff',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffNo: text('staff_no')
      .notNull()
      .unique()
      .default(sql`dk_number('STF-', nextval('staff_number_seq'), 3)`),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    role: staffRole('role').notNull(),
    status: staffStatus('status').notNull().default('active'),
    passwordHash: text('password_hash').notNull(),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamptz('locked_until'),
    lastLoginAt: timestamptz('last_login_at'),
    passwordChangedAt: timestamptz('password_changed_at').notNull().defaultNow(),
    deletedAt: timestamptz('deleted_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  // A deleted account keeps its row for history, so its email can be used again.
  (t) => [uniqueIndex('staff_email_unique').on(sql`lower(${t.email})`).where(sql`${t.deletedAt} IS NULL`)],
);

/** Only the SHA-256 hash of a session token is stored, so a database leak exposes no sessions. */
export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    remember: boolean('remember').notNull().default(false),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
  },
  (t) => [index('admin_sessions_staff_idx').on(t.staffId), index('admin_sessions_expires_idx').on(t.expiresAt)],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('password_reset_tokens_staff_idx').on(t.staffId)],
);

/** Who changed what. Never store passwords, password hashes or tokens here. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorStaffId: uuid('actor_staff_id').references(() => staff.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    oldValues: jsonb('old_values'),
    newValues: jsonb('new_values'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_log_entity_idx').on(t.entityType, t.entityId, t.createdAt), index('audit_log_actor_idx').on(t.actorStaffId)],
);

/** One row only (id 1). Times of day are stored as minutes from midnight; 1440 is the end of the day. */
export const settings = pgTable(
  'settings',
  {
    id: integer('id').primaryKey().default(1),
    venueName: text('venue_name').notNull(),
    address: text('address'),
    phone: text('phone'),
    email: text('email'),
    slotMinutes: integer('slot_minutes').notNull().default(60),
    advanceBookingDays: integer('advance_booking_days').notNull().default(7),
    minNoticeMinutes: integer('min_notice_minutes').notNull().default(60),
    holdMinutes: integer('hold_minutes').notNull().default(10),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [check('settings_single_row', sql`${t.id} = 1`), check('settings_slot_minutes', sql`${t.slotMinutes} IN (30, 60)`)],
);

export const courts = pgTable(
  'courts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('courts_name_unique').on(sql`lower(${t.name})`)],
);

/** Weekday 0 is Sunday. A day with no rows is closed, and a day may have a morning and an evening period. */
export const openingHours = pgTable(
  'opening_hours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    weekday: integer('weekday').notNull(),
    openMinute: integer('open_minute').notNull(),
    closeMinute: integer('close_minute').notNull(),
  },
  (t) => [
    index('opening_hours_weekday_idx').on(t.weekday),
    check('opening_hours_weekday', sql`${t.weekday} BETWEEN 0 AND 6`),
    check('opening_hours_times', sql`${t.openMinute} >= 0 AND ${t.closeMinute} <= 1440 AND ${t.openMinute} < ${t.closeMinute}`),
  ],
);

/** An hourly rate. A rule for one court wins over a rule for all courts (no court set). */
export const priceRules = pgTable(
  'price_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courtId: uuid('court_id').references(() => courts.id, { onDelete: 'cascade' }),
    days: integer('days').array().notNull(),
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),
    ratePaise: integer('rate_paise').notNull(),
  },
  (t) => [
    check('price_rules_times', sql`${t.startMinute} >= 0 AND ${t.endMinute} <= 1440 AND ${t.startMinute} < ${t.endMinute}`),
    check('price_rules_rate', sql`${t.ratePaise} >= 0`),
  ],
);

/** A court, or the whole venue when no court is set, is shut for this period. */
export const closures = pgTable(
  'closures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courtId: uuid('court_id').references(() => courts.id, { onDelete: 'cascade' }),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    reason: text('reason'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('closures_period_idx').on(t.startsAt, t.endsAt), check('closures_period', sql`${t.startsAt} < ${t.endsAt}`)],
);

/**
 * Every hold on a court's time. An exclusion constraint (see the migration) makes two active
 * reservations for the same court and time impossible, even when two requests arrive together.
 */
export const courtReservations = pgTable(
  'court_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courtId: uuid('court_id')
      .notNull()
      .references(() => courts.id, { onDelete: 'restrict' }),
    kind: reservationKind('kind').notNull(),
    status: reservationStatus('status').notNull().default('active'),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    note: text('note'),
    // Set on a block that exists because of a batch or a court membership.
    batchId: uuid('batch_id').references((): AnyPgColumn => memberBatches.id, { onDelete: 'set null' }),
    membershipId: uuid('membership_id').references((): AnyPgColumn => memberships.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('court_reservations_batch_idx').on(t.batchId), index('court_reservations_membership_idx').on(t.membershipId), index('court_reservations_period_idx').on(t.startsAt, t.endsAt), check('court_reservations_period', sql`${t.startsAt} < ${t.endsAt}`)],
);

/** Non-member customers. Walk-ins are numbered WLK-, website customers WEB-, in separate sequences. */
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerNo: text('customer_no').notNull().unique(),
    type: customerType('type').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    email: text('email'),
    notes: text('notes'),
    deletedAt: timestamptz('deleted_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('customers_type_idx').on(t.type), index('customers_phone_idx').on(t.phone)],
);

/** A customer's paid court time. The time itself is held by its reservation, which guards against clashes. */
export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingNo: text('booking_no')
      .notNull()
      .unique()
      .default(sql`dk_number('BKG-', nextval('booking_number_seq'), 5)`),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    reservationId: uuid('reservation_id')
      .notNull()
      .unique()
      .references(() => courtReservations.id, { onDelete: 'restrict' }),
    amountPaise: integer('amount_paise').notNull(),
    source: bookingSource('source').notNull().default('admin'),
    status: bookingStatus('status').notNull().default('active'),
    notes: text('notes'),
    cancelReason: text('cancel_reason'),
    // Only the hash is stored, so a database leak can't open anyone's booking page.
    accessTokenHash: text('access_token_hash').unique(),
    holdExpiresAt: timestamptz('hold_expires_at'),
    cancelledAt: timestamptz('cancelled_at'),
    createdBy: uuid('created_by').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('bookings_customer_idx').on(t.customerId), check('bookings_amount', sql`${t.amountPaise} >= 0`)],
);

/** Money staff received. A receipt is never edited: a mistake is voided, with a reason, and recorded again. */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    receiptNo: text('receipt_no')
      .notNull()
      .unique()
      .default(sql`dk_number('RCP-', nextval('receipt_number_seq'), 5)`),
    // A receipt pays for either a booking or one month of a membership, never both.
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'restrict' }),
    periodId: uuid('period_id').references(() => membershipPeriods.id, { onDelete: 'restrict' }),
    amountPaise: integer('amount_paise').notNull(),
    method: paymentMethod('method').notNull(),
    reference: text('reference'),
    receivedAt: timestamptz('received_at').notNull().defaultNow(),
    recordedBy: uuid('recorded_by').references(() => staff.id, { onDelete: 'set null' }),
    voidedAt: timestamptz('voided_at'),
    voidReason: text('void_reason'),
    voidedBy: uuid('voided_by').references(() => staff.id, { onDelete: 'set null' }),
  },
  (t) => [index('payments_booking_idx').on(t.bookingId), index('payments_received_idx').on(t.receivedAt), index('payments_period_idx').on(t.periodId), check('payments_amount', sql`${t.amountPaise} > 0`), check('payments_one_target', sql`num_nonnulls(${t.bookingId}, ${t.periodId}) = 1`)],
);

export const enquiries = pgTable(
  'enquiries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    enquiryNo: text('enquiry_no')
      .notNull()
      .unique()
      .default(sql`dk_number('ENQ-', nextval('enquiry_number_seq'), 5)`),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    topic: text('topic'),
    preferred: text('preferred'),
    message: text('message').notNull(),
    status: enquiryStatus('status').notNull().default('new'),
    notes: text('notes'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('enquiries_status_idx').on(t.status, t.createdAt)],
);

/**
 * Who messages come from, all set in the admin panel. One row only (id 1), kept apart from
 * `settings` because every role can read that. The app password is stored encrypted.
 */
export const messageSettings = pgTable(
  'message_settings',
  {
    id: integer('id').primaryKey().default(1),
    emailEnabled: boolean('email_enabled').notNull().default(true),
    senderName: text('sender_name'),
    senderEmail: text('sender_email'),
    appPasswordEncrypted: text('app_password_encrypted'),
    notifyEmail: text('notify_email'),
    dailyEmailLimit: integer('daily_email_limit').notNull().default(100),
    whatsappNumber: text('whatsapp_number'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [check('message_settings_single_row', sql`${t.id} = 1`)],
);

/**
 * Every message, sent or waiting. A body may hold {{link}}, filled in only when sending,
 * so a customer's private link is never stored here.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channel: messageChannel('channel').notNull().default('email'),
    template: text('template').notNull(),
    recipient: text('recipient').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: messageStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamptz('next_attempt_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at'),
    lastError: text('last_error'),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    enquiryId: uuid('enquiry_id').references(() => enquiries.id, { onDelete: 'set null' }),
    membershipId: uuid('membership_id').references(() => memberships.id, { onDelete: 'set null' }),
    sentAt: timestamptz('sent_at'),
    createdBy: uuid('created_by').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('messages_queue_idx').on(t.status, t.nextAttemptAt), index('messages_booking_idx').on(t.bookingId), index('messages_created_idx').on(t.createdAt)],
);

/** What the Owner sells. `features` are whatever extras the Owner wants to list. */
export const membershipPlans = pgTable(
  'membership_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    kind: membershipKind('kind').notNull(),
    description: text('description'),
    features: text('features').array().notNull().default(sql`'{}'::text[]`),
    // Per person for an individual plan, per court for a court plan.
    pricePaise: integer('price_paise').notNull(),
    playersPerCourt: integer('players_per_court').notNull().default(10),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('membership_plans_name_unique').on(sql`lower(${t.name})`), check('membership_plans_price', sql`${t.pricePaise} >= 0`), check('membership_plans_players', sql`${t.playersPerCourt} BETWEEN 1 AND 10`)],
);

/** A fixed weekly time that individual members share. It holds the court from its first date to its last. */
export const memberBatches = pgTable(
  'member_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => membershipPlans.id, { onDelete: 'restrict' }),
    courtId: uuid('court_id')
      .notNull()
      .references(() => courts.id, { onDelete: 'restrict' }),
    days: integer('days').array().notNull(),
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),
    capacity: integer('capacity').notNull(),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [check('member_batches_capacity', sql`${t.capacity} >= 1`), check('member_batches_dates', sql`${t.startsOn} <= ${t.endsOn}`)],
);

/** One person in a batch (MEM-), or a group holding whole courts at a fixed time (CRT-). */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    membershipNo: text('membership_no').notNull().unique(),
    kind: membershipKind('kind').notNull(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => membershipPlans.id, { onDelete: 'restrict' }),
    batchId: uuid('batch_id').references(() => memberBatches.id, { onDelete: 'restrict' }),
    // A court membership's own fixed time. An individual member's comes from their batch.
    days: integer('days').array(),
    startMinute: integer('start_minute'),
    endMinute: integer('end_minute'),
    holderName: text('holder_name').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    notes: text('notes'),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    pricePaise: integer('price_paise').notNull(),
    status: membershipStatus('status').notNull().default('active'),
    source: bookingSource('source').notNull().default('admin'),
    cancelReason: text('cancel_reason'),
    cancelledAt: timestamptz('cancelled_at'),
    accessTokenHash: text('access_token_hash').unique(),
    holdExpiresAt: timestamptz('hold_expires_at'),
    deletedAt: timestamptz('deleted_at'),
    createdBy: uuid('created_by').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('memberships_batch_idx').on(t.batchId), index('memberships_ends_idx').on(t.endsOn), check('memberships_price', sql`${t.pricePaise} >= 0`)],
);

export const membershipCourts = pgTable(
  'membership_courts',
  {
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    courtId: uuid('court_id')
      .notNull()
      .references(() => courts.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.courtId] })],
);

export const membershipPlayers = pgTable(
  'membership_players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: text('phone'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('membership_players_membership_idx').on(t.membershipId)],
);

/** One paid month. The amount is copied here, so changing a plan's price never rewrites history. */
export const membershipPeriods = pgTable(
  'membership_periods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    // What's owed, after any referral discount or credit, which are kept so the sum can be explained.
    amountPaise: integer('amount_paise').notNull(),
    discountPaise: integer('discount_paise').notNull().default(0),
    creditPaise: integer('credit_paise').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('membership_periods_membership_idx').on(t.membershipId), check('membership_periods_amount', sql`${t.amountPaise} >= 0`)],
);

/** One row only (id 1). Off until the Owner switches it on, so nobody gets a discount by accident. */
export const referralProgram = pgTable(
  'referral_program',
  {
    id: integer('id').primaryKey().default(1),
    enabled: boolean('enabled').notNull().default(false),
    discountType: discountType('discount_type').notNull().default('percent'),
    // A percentage (1 to 100) or paise, depending on the type.
    discountValue: integer('discount_value').notNull().default(10),
    rewardPaise: integer('reward_paise').notNull().default(0),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [check('referral_program_single_row', sql`${t.id} = 1`)],
);

/** A member's own code, or (with no membership) a code the Owner hands out, such as for a promotion. */
export const referralCodes = pgTable(
  'referral_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(),
    membershipId: uuid('membership_id').references(() => memberships.id, { onDelete: 'cascade' }),
    label: text('label'),
    active: boolean('active').notNull().default(true),
    maxUses: integer('max_uses'),
    expiresOn: date('expires_on', { mode: 'string' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('referral_codes_member_unique').on(t.membershipId).where(sql`${t.membershipId} IS NOT NULL`)],
);

export const referralRedemptions = pgTable(
  'referral_redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codeId: uuid('code_id')
      .notNull()
      .references(() => referralCodes.id, { onDelete: 'restrict' }),
    membershipId: uuid('membership_id')
      .notNull()
      .unique()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    discountPaise: integer('discount_paise').notNull(),
    rewardPaise: integer('reward_paise').notNull().default(0),
    // Set when the new member has paid in full and the referrer got their credit.
    creditedAt: timestamptz('credited_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('referral_redemptions_code_idx').on(t.codeId)],
);

/** Money a member can put towards a renewal. Earned is positive, spent is negative; the balance is the sum. */
export const memberCredits = pgTable(
  'member_credits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    amountPaise: integer('amount_paise').notNull(),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('member_credits_membership_idx').on(t.membershipId)],
);

export type Staff = typeof staff.$inferSelect;
export type StaffRole = (typeof staffRole.enumValues)[number];

const bytes = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** One row only (id 1): everything the website says, as edited in the admin panel. */
export const siteContent = pgTable(
  'site_content',
  {
    id: integer('id').primaryKey().default(1),
    content: jsonb('content').notNull().default(sql`'{}'::jsonb`),
    version: integer('version').notNull().default(1),
    updatedByStaffId: uuid('updated_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [check('site_content_single_row', sql`${t.id} = 1`)],
);

/** Photos uploaded for the website. They live in the database so they survive a change of host. */
export const siteImages = pgTable('site_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  data: bytes('data').notNull(),
  contentType: text('content_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

import { sql, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * The database is SQLite (Cloudflare D1). Rules that must hold however a row is changed live in
 * triggers in drizzle/0001_rules.sql: at most 5 active staff, always one active Owner, no two
 * active reservations on one court at once, and record numbers that are never reused.
 */

/** A text column limited to a fixed list, with the list kept for validation in routes. */
function enumType<const T extends readonly [string, ...string[]]>(values: T) {
  const column = (name: string) => text(name, { enum: values as unknown as [T[number], ...T[number][]] });
  return Object.assign(column, { enumValues: values as unknown as [T[number], ...T[number][]] });
}
const inList = (column: AnySQLiteColumn, values: readonly string[]) => sql.raw(`"${column.name}" IN (${values.map((v) => `'${v}'`).join(', ')})`);

export const staffRole = enumType(['owner', 'manager', 'front_desk']);
export const staffStatus = enumType(['active', 'inactive']);
export const reservationKind = enumType(['booking', 'member_block', 'staff_block']);
export const reservationStatus = enumType(['active', 'released']);
export const customerType = enumType(['walk_in', 'website']);
export const bookingStatus = enumType(['active', 'cancelled', 'pending_payment', 'expired']);
export const bookingSource = enumType(['admin', 'website']);
// online = through the payment gateway; online_test = the local simulator, which moves no money.
export const paymentMethod = enumType(['cash', 'upi', 'online', 'online_test']);
export const paymentGateway = enumType(['cashfree', 'razorpay']);
export const gatewayMode = enumType(['test', 'live']);
export const enquiryStatus = enumType(['new', 'handled']);
export const membershipKind = enumType(['individual', 'court']);
export const membershipStatus = enumType(['active', 'cancelled', 'pending_payment', 'expired']);
export const discountType = enumType(['percent', 'fixed']);
export const messageChannel = enumType(['email', 'whatsapp']);
export const messageStatus = enumType(['queued', 'sending', 'sent', 'failed', 'expired', 'cancelled']);

/** Milliseconds since 1970, read and written as a Date. */
const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });
const NOW_MS = sql`(cast(unixepoch('subsec') * 1000 as integer))`;
const createdNow = (name: string) => timestamp(name).notNull().default(NOW_MS);
const flag = (name: string) => integer(name, { mode: 'boolean' });
/** 'YYYY-MM-DD', which sorts and compares like a date. */
const day = (name: string) => text(name);
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();
const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());

/**
 * A phone's digits only, worked out by the database from the phone column so it can never go stale.
 * Phones are validated as +, digits, spaces and hyphens, so stripping those leaves the digits.
 */
const STRIPPED_FROM_PHONES = [32, 45, 43, 9, 10, 11, 12, 13, 160]; // space - + and the whitespace characters
const phoneDigitsOf = (column: string) =>
  text(`${column}_digits`).generatedAlwaysAs(
    sql.raw(STRIPPED_FROM_PHONES.reduce((expr, code) => `replace(${expr}, char(${code}), '')`, `"${column}"`)),
    { mode: 'virtual' },
  );

/**
 * Record numbers such as BKG-00042. The insert reads the next value here, and a trigger on the
 * table moves the counter on, both inside the one statement, so a number is never handed out twice
 * or reused after a delete.
 */
export const counters = sqliteTable('counters', {
  prefix: text('prefix').primaryKey(),
  value: integer('value').notNull().default(0),
});

export const nextNumber = (prefix: string, width: number): SQL<string> =>
  sql<string>`(SELECT printf(${`${prefix}%0${width}d`}, value + 1) FROM counters WHERE prefix = ${prefix})`;

/** On a booking or membership paid online: the gateway's order, when it was made, and when the cron last asked about it. */
const gatewayOrderColumns = () => ({
  gatewayOrderId: text('gateway_order_id'),
  gatewayOrderAt: timestamp('gateway_order_at'),
  gatewayCheckedAt: timestamp('gateway_checked_at'),
});

/** Admin accounts. Triggers keep at most 5 active accounts and always one active Owner. */
export const staff = sqliteTable(
  'staff',
  {
    id: id(),
    staffNo: text('staff_no')
      .notNull()
      .unique()
      .$defaultFn(() => nextNumber('STF-', 3)),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    role: staffRole('role').notNull(),
    status: staffStatus('status').notNull().default('active'),
    passwordHash: text('password_hash').notNull(),
    mustChangePassword: flag('must_change_password').notNull().default(false),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until'),
    lastLoginAt: timestamp('last_login_at'),
    passwordChangedAt: createdNow('password_changed_at'),
    deletedAt: timestamp('deleted_at'),
    createdAt: createdNow('created_at'),
    updatedAt: createdNow('updated_at'),
  },
  // A deleted account keeps its row for history, so its email can be used again.
  (t) => [
    uniqueIndex('staff_email_unique').on(sql`lower(${t.email})`).where(sql`${t.deletedAt} IS NULL`),
    check('staff_role_valid', inList(t.role, staffRole.enumValues)),
    check('staff_status_valid', inList(t.status, staffStatus.enumValues)),
  ],
);

/** Only the SHA-256 hash of a session token is stored, so a database leak exposes no sessions. */
export const adminSessions = sqliteTable(
  'admin_sessions',
  {
    id: id(),
    staffId: text('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    remember: flag('remember').notNull().default(false),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdNow('created_at'),
    lastSeenAt: createdNow('last_seen_at'),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (t) => [index('admin_sessions_staff_idx').on(t.staffId), index('admin_sessions_expires_idx').on(t.expiresAt)],
);

export const passwordResetTokens = sqliteTable(
  'password_reset_tokens',
  {
    id: id(),
    staffId: text('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    createdAt: createdNow('created_at'),
  },
  (t) => [index('password_reset_tokens_staff_idx').on(t.staffId)],
);

/** Who changed what. Never store passwords, password hashes or tokens here. */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actorStaffId: text('actor_staff_id').references(() => staff.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    oldValues: json<unknown>('old_values'),
    newValues: json<unknown>('new_values'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdNow('created_at'),
  },
  (t) => [index('audit_log_entity_idx').on(t.entityType, t.entityId, t.createdAt), index('audit_log_actor_idx').on(t.actorStaffId)],
);

/** One row only (id 1). Times of day are stored as minutes from midnight; 1440 is the end of the day. */
export const settings = sqliteTable(
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
    updatedAt: createdNow('updated_at'),
  },
  (t) => [check('settings_single_row', sql`${t.id} = 1`), check('settings_slot_minutes', sql`${t.slotMinutes} IN (30, 60)`)],
);

export const courts = sqliteTable(
  'courts',
  {
    id: id(),
    name: text('name').notNull(),
    active: flag('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdNow('created_at'),
    updatedAt: createdNow('updated_at'),
  },
  (t) => [uniqueIndex('courts_name_unique').on(sql`lower(${t.name})`)],
);

/** Weekday 0 is Sunday. A day with no rows is closed, and a day may have a morning and an evening period. */
export const openingHours = sqliteTable(
  'opening_hours',
  {
    id: id(),
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
export const priceRules = sqliteTable(
  'price_rules',
  {
    id: id(),
    courtId: text('court_id').references(() => courts.id, { onDelete: 'cascade' }),
    days: json<number[]>('days').notNull(),
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
export const closures = sqliteTable(
  'closures',
  {
    id: id(),
    courtId: text('court_id').references(() => courts.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at').notNull(),
    endsAt: timestamp('ends_at').notNull(),
    reason: text('reason'),
    createdAt: createdNow('created_at'),
  },
  (t) => [index('closures_period_idx').on(t.startsAt, t.endsAt), check('closures_period', sql`${t.startsAt} < ${t.endsAt}`)],
);

/**
 * Every hold on a court's time. Triggers (see the migration) make two active reservations for the
 * same court and time impossible. D1 runs one write at a time, so two requests can't both get in.
 */
export const courtReservations = sqliteTable(
  'court_reservations',
  {
    id: id(),
    courtId: text('court_id')
      .notNull()
      .references(() => courts.id, { onDelete: 'restrict' }),
    kind: reservationKind('kind').notNull(),
    status: reservationStatus('status').notNull().default('active'),
    startsAt: timestamp('starts_at').notNull(),
    endsAt: timestamp('ends_at').notNull(),
    note: text('note'),
    // Set on a block that exists because of a batch or a court membership.
    batchId: text('batch_id').references((): AnySQLiteColumn => memberBatches.id, { onDelete: 'set null' }),
    membershipId: text('membership_id').references((): AnySQLiteColumn => memberships.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: createdNow('created_at'),
  },
  (t) => [
    index('court_reservations_batch_idx').on(t.batchId),
    index('court_reservations_membership_idx').on(t.membershipId),
    index('court_reservations_period_idx').on(t.startsAt, t.endsAt),
    index('court_reservations_court_idx').on(t.courtId, t.status, t.startsAt),
    check('court_reservations_period', sql`${t.startsAt} < ${t.endsAt}`),
    check('court_reservations_kind_valid', inList(t.kind, reservationKind.enumValues)),
    check('court_reservations_status_valid', inList(t.status, reservationStatus.enumValues)),
  ],
);

/** Non-member customers. Walk-ins are numbered WLK-, website customers WEB-, each counted separately. */
export const customers = sqliteTable(
  'customers',
  {
    id: id(),
    customerNo: text('customer_no').notNull().unique(),
    type: customerType('type').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    // So a search finds +91 98400-12345 by typing 9840012345.
    phoneDigits: phoneDigitsOf('phone'),
    email: text('email'),
    notes: text('notes'),
    deletedAt: timestamp('deleted_at'),
    createdAt: createdNow('created_at'),
    updatedAt: createdNow('updated_at'),
  },
  (t) => [
    index('customers_type_idx').on(t.type),
    index('customers_phone_idx').on(t.phone),
    index('customers_phone_digits_idx').on(t.phoneDigits),
    check('customers_type_valid', inList(t.type, customerType.enumValues)),
  ],
);

/** A customer's paid court time. The time itself is held by its reservation, which guards against clashes. */
export const bookings = sqliteTable(
  'bookings',
  {
    id: id(),
    bookingNo: text('booking_no')
      .notNull()
      .unique()
      .$defaultFn(() => nextNumber('BKG-', 5)),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    reservationId: text('reservation_id')
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
    holdExpiresAt: timestamp('hold_expires_at'),
    cancelledAt: timestamp('cancelled_at'),
    ...gatewayOrderColumns(),
    createdBy: text('created_by').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: createdNow('created_at'),
    updatedAt: createdNow('updated_at'),
  },
  (t) => [
    index('bookings_customer_idx').on(t.customerId),
    index('bookings_gateway_order_idx').on(t.gatewayOrderId),
    check('bookings_amount', sql`${t.amountPaise} >= 0`),
    check('bookings_source_valid', inList(t.source, bookingSource.enumValues)),
    check('bookings_status_valid', inList(t.status, bookingStatus.enumValues)),
  ],
);

/** Money staff received. A receipt is never edited: a mistake is voided, with a reason, and recorded again. */
export const payments = sqliteTable(
  'payments',
  {
    id: id(),
    receiptNo: text('receipt_no')
      .notNull()
      .unique()
      .$defaultFn(() => nextNumber('RCP-', 5)),
    // A receipt pays for either a booking or one month of a membership, never both.
    bookingId: text('booking_id').references(() => bookings.id, { onDelete: 'restrict' }),
    periodId: text('period_id').references((): AnySQLiteColumn => membershipPeriods.id, { onDelete: 'restrict' }),
    amountPaise: integer('amount_paise').notNull(),
    method: paymentMethod('method').notNull(),
    reference: text('reference'),
    receivedAt: createdNow('received_at'),
    recordedBy: text('recorded_by').references(() => staff.id, { onDelete: 'set null' }),
    voidedAt: timestamp('voided_at'),
    voidReason: text('void_reason'),
    voidedBy: text('voided_by').references(() => staff.id, { onDelete: 'set null' }),
    // Online payments only. The gateway's payment id is unique, so the same payment can't be recorded twice.
    gateway: paymentGateway('gateway'),
    gatewayOrderId: text('gateway_order_id'),
    gatewayPaymentId: text('gateway_payment_id').unique(),
    // A refunded receipt is also voided, so every total that leaves out voided receipts leaves it out too.
    refundedAt: timestamp('refunded_at'),
    gatewayRefundId: text('gateway_refund_id'),
  },
  (t) => [
    index('payments_booking_idx').on(t.bookingId),
    index('payments_received_idx').on(t.receivedAt),
    index('payments_period_idx').on(t.periodId),
    check('payments_amount', sql`${t.amountPaise} > 0`),
    check('payments_one_target', sql`(${t.bookingId} IS NOT NULL) + (${t.periodId} IS NOT NULL) = 1`),
    check('payments_method_valid', inList(t.method, paymentMethod.enumValues)),
  ],
);

export const enquiries = sqliteTable(
  'enquiries',
  {
    id: id(),
    enquiryNo: text('enquiry_no')
      .notNull()
      .unique()
      .$defaultFn(() => nextNumber('ENQ-', 5)),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    topic: text('topic'),
    preferred: text('preferred'),
    message: text('message').notNull(),
    status: enquiryStatus('status').notNull().default('new'),
    notes: text('notes'),
    createdAt: createdNow('created_at'),
    updatedAt: createdNow('updated_at'),
  },
  (t) => [index('enquiries_status_idx').on(t.status, t.createdAt), check('enquiries_status_valid', inList(t.status, enquiryStatus.enumValues))],
);

/**
 * Who messages come from, all set in the admin panel. One row only (id 1), kept apart from
 * `settings` because every role can read that. The app password is stored encrypted.
 */
export const messageSettings = sqliteTable(
  'message_settings',
  {
    id: integer('id').primaryKey().default(1),
    emailEnabled: flag('email_enabled').notNull().default(true),
    senderName: text('sender_name'),
    senderEmail: text('sender_email'),
    appPasswordEncrypted: text('app_password_encrypted'),
    notifyEmail: text('notify_email'),
    dailyEmailLimit: integer('daily_email_limit').notNull().default(100),
    whatsappNumber: text('whatsapp_number'),
    updatedAt: createdNow('updated_at'),
  },
  (t) => [check('message_settings_single_row', sql`${t.id} = 1`)],
);

/**
 * Every message, sent or waiting. A body may hold {{link}}, filled in only when sending,
 * so a customer's private link is never stored here.
 */
export const messages = sqliteTable(
  'messages',
  {
    id: id(),
    channel: messageChannel('channel').notNull().default('email'),
    template: text('template').notNull(),
    recipient: text('recipient').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: messageStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: createdNow('next_attempt_at'),
    expiresAt: timestamp('expires_at'),
    lastError: text('last_error'),
    bookingId: text('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    enquiryId: text('enquiry_id').references(() => enquiries.id, { onDelete: 'set null' }),
    membershipId: text('membership_id').references((): AnySQLiteColumn => memberships.id, { onDelete: 'set null' }),
    sentAt: timestamp('sent_at'),
    createdBy: text('created_by').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: createdNow('created_at'),
  },
  (t) => [
    index('messages_queue_idx').on(t.status, t.nextAttemptAt),
    index('messages_booking_idx').on(t.bookingId),
    index('messages_created_idx').on(t.createdAt),
    check('messages_channel_valid', inList(t.channel, messageChannel.enumValues)),
    check('messages_status_valid', inList(t.status, messageStatus.enumValues)),
  ],
);

/** What the Owner sells. `features` are whatever extras the Owner wants to list. */
export const membershipPlans = sqliteTable(
  'membership_plans',
  {
    id: id(),
    name: text('name').notNull(),
    kind: membershipKind('kind').notNull(),
    description: text('description'),
    features: json<string[]>('features')
      .notNull()
      .$defaultFn(() => []),
    // Per person for an individual plan, per court for a court plan.
    pricePaise: integer('price_paise').notNull(),
    playersPerCourt: integer('players_per_court').notNull().default(10),
    active: flag('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdNow('created_at'),
    updatedAt: createdNow('updated_at'),
  },
  (t) => [
    uniqueIndex('membership_plans_name_unique').on(sql`lower(${t.name})`),
    check('membership_plans_price', sql`${t.pricePaise} >= 0`),
    check('membership_plans_players', sql`${t.playersPerCourt} BETWEEN 1 AND 10`),
    check('membership_plans_kind_valid', inList(t.kind, membershipKind.enumValues)),
  ],
);

/** A fixed weekly time that individual members share. It holds the court from its first date to its last. */
export const memberBatches = sqliteTable(
  'member_batches',
  {
    id: id(),
    name: text('name').notNull(),
    planId: text('plan_id')
      .notNull()
      .references(() => membershipPlans.id, { onDelete: 'restrict' }),
    courtId: text('court_id')
      .notNull()
      .references(() => courts.id, { onDelete: 'restrict' }),
    days: json<number[]>('days').notNull(),
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),
    capacity: integer('capacity').notNull(),
    startsOn: day('starts_on').notNull(),
    endsOn: day('ends_on').notNull(),
    active: flag('active').notNull().default(true),
    createdAt: createdNow('created_at'),
    updatedAt: createdNow('updated_at'),
  },
  (t) => [check('member_batches_capacity', sql`${t.capacity} >= 1`), check('member_batches_dates', sql`${t.startsOn} <= ${t.endsOn}`)],
);

/** One person in a batch (MEM-), or a group holding whole courts at a fixed time (CRT-). */
export const memberships = sqliteTable(
  'memberships',
  {
    id: id(),
    membershipNo: text('membership_no').notNull().unique(),
    kind: membershipKind('kind').notNull(),
    planId: text('plan_id')
      .notNull()
      .references(() => membershipPlans.id, { onDelete: 'restrict' }),
    batchId: text('batch_id').references(() => memberBatches.id, { onDelete: 'restrict' }),
    // A court membership's own fixed time. An individual member's comes from their batch.
    days: json<number[]>('days'),
    startMinute: integer('start_minute'),
    endMinute: integer('end_minute'),
    holderName: text('holder_name').notNull(),
    phone: text('phone').notNull(),
    phoneDigits: phoneDigitsOf('phone'),
    email: text('email'),
    notes: text('notes'),
    startsOn: day('starts_on').notNull(),
    endsOn: day('ends_on').notNull(),
    pricePaise: integer('price_paise').notNull(),
    status: membershipStatus('status').notNull().default('active'),
    source: bookingSource('source').notNull().default('admin'),
    cancelReason: text('cancel_reason'),
    cancelledAt: timestamp('cancelled_at'),
    accessTokenHash: text('access_token_hash').unique(),
    holdExpiresAt: timestamp('hold_expires_at'),
    ...gatewayOrderColumns(),
    deletedAt: timestamp('deleted_at'),
    createdBy: text('created_by').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: createdNow('created_at'),
    updatedAt: createdNow('updated_at'),
  },
  (t) => [
    index('memberships_batch_idx').on(t.batchId),
    index('memberships_ends_idx').on(t.endsOn),
    index('memberships_phone_digits_idx').on(t.phoneDigits),
    index('memberships_gateway_order_idx').on(t.gatewayOrderId),
    check('memberships_price', sql`${t.pricePaise} >= 0`),
    check('memberships_kind_valid', inList(t.kind, membershipKind.enumValues)),
    check('memberships_status_valid', inList(t.status, membershipStatus.enumValues)),
    check('memberships_source_valid', inList(t.source, bookingSource.enumValues)),
  ],
);

export const membershipCourts = sqliteTable(
  'membership_courts',
  {
    membershipId: text('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    courtId: text('court_id')
      .notNull()
      .references(() => courts.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.courtId] })],
);

export const membershipPlayers = sqliteTable(
  'membership_players',
  {
    id: id(),
    membershipId: text('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: text('phone'),
    createdAt: createdNow('created_at'),
  },
  (t) => [index('membership_players_membership_idx').on(t.membershipId)],
);

/** One paid month. The amount is copied here, so changing a plan's price never rewrites history. */
export const membershipPeriods = sqliteTable(
  'membership_periods',
  {
    id: id(),
    membershipId: text('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    startsOn: day('starts_on').notNull(),
    endsOn: day('ends_on').notNull(),
    // What's owed, after any referral discount or credit, which are kept so the sum can be explained.
    amountPaise: integer('amount_paise').notNull(),
    discountPaise: integer('discount_paise').notNull().default(0),
    creditPaise: integer('credit_paise').notNull().default(0),
    createdAt: createdNow('created_at'),
  },
  (t) => [index('membership_periods_membership_idx').on(t.membershipId), check('membership_periods_amount', sql`${t.amountPaise} >= 0`)],
);

/** One row only (id 1). Off until the Owner switches it on, so nobody gets a discount by accident. */
export const referralProgram = sqliteTable(
  'referral_program',
  {
    id: integer('id').primaryKey().default(1),
    enabled: flag('enabled').notNull().default(false),
    discountType: discountType('discount_type').notNull().default('percent'),
    // A percentage (1 to 100) or paise, depending on the type.
    discountValue: integer('discount_value').notNull().default(10),
    rewardPaise: integer('reward_paise').notNull().default(0),
    updatedAt: createdNow('updated_at'),
  },
  (t) => [check('referral_program_single_row', sql`${t.id} = 1`), check('referral_program_type_valid', inList(t.discountType, discountType.enumValues))],
);

/** A member's own code, or (with no membership) a code the Owner hands out, such as for a promotion. */
export const referralCodes = sqliteTable(
  'referral_codes',
  {
    id: id(),
    code: text('code').notNull().unique(),
    membershipId: text('membership_id').references(() => memberships.id, { onDelete: 'cascade' }),
    label: text('label'),
    active: flag('active').notNull().default(true),
    maxUses: integer('max_uses'),
    expiresOn: day('expires_on'),
    createdAt: createdNow('created_at'),
    updatedAt: createdNow('updated_at'),
  },
  (t) => [uniqueIndex('referral_codes_member_unique').on(t.membershipId).where(sql`${t.membershipId} IS NOT NULL`)],
);

export const referralRedemptions = sqliteTable(
  'referral_redemptions',
  {
    id: id(),
    codeId: text('code_id')
      .notNull()
      .references(() => referralCodes.id, { onDelete: 'restrict' }),
    membershipId: text('membership_id')
      .notNull()
      .unique()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    discountPaise: integer('discount_paise').notNull(),
    rewardPaise: integer('reward_paise').notNull().default(0),
    // Set when the new member has paid in full and the referrer got their credit.
    creditedAt: timestamp('credited_at'),
    createdAt: createdNow('created_at'),
  },
  (t) => [index('referral_redemptions_code_idx').on(t.codeId)],
);

/** Money a member can put towards a renewal. Earned is positive, spent is negative; the balance is the sum. */
export const memberCredits = sqliteTable(
  'member_credits',
  {
    id: id(),
    membershipId: text('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    amountPaise: integer('amount_paise').notNull(),
    reason: text('reason').notNull(),
    createdBy: text('created_by').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: createdNow('created_at'),
  },
  (t) => [index('member_credits_membership_idx').on(t.membershipId)],
);

export type Staff = typeof staff.$inferSelect;
export type StaffRole = (typeof staffRole.enumValues)[number];

/** One row only (id 1): everything the website says, as edited in the admin panel. */
export const siteContent = sqliteTable(
  'site_content',
  {
    id: integer('id').primaryKey().default(1),
    content: json<unknown>('content').notNull().default(sql`'{}'`),
    version: integer('version').notNull().default(1),
    updatedByStaffId: text('updated_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
    updatedAt: createdNow('updated_at'),
  },
  (t) => [check('site_content_single_row', sql`${t.id} = 1`)],
);

/** Photos uploaded for the website. The file itself is in R2 under photos/<id>; this row lists it. */
export const siteImages = sqliteTable('site_images', {
  id: id(),
  contentType: text('content_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  createdAt: createdNow('created_at'),
});

/**
 * One row only (id 1): the payment gateway the Owner set up in Settings. The secrets are encrypted
 * with APP_SECRET, like the Gmail app password, and never sent back to the browser.
 */
export const paymentSettings = sqliteTable(
  'payment_settings',
  {
    id: integer('id').primaryKey().default(1),
    enabled: flag('enabled').notNull().default(false),
    gateway: paymentGateway('gateway'),
    mode: gatewayMode('mode').notNull().default('test'),
    // Cashfree App ID or Razorpay Key ID. Not secret: Razorpay's is shown to the browser for checkout.
    keyId: text('key_id'),
    keySecretEncrypted: text('key_secret_encrypted'),
    // Razorpay only: the secret typed in when the webhook was created. Cashfree signs with the key secret.
    webhookSecretEncrypted: text('webhook_secret_encrypted'),
    updatedByStaffId: text('updated_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
    updatedAt: createdNow('updated_at'),
  },
  (t) => [check('payment_settings_single_row', sql`${t.id} = 1`)],
);

/** Online payments staff need to look at, such as money that arrived after the slot was taken and was refunded. */
export const paymentIssues = sqliteTable(
  'payment_issues',
  {
    id: id(),
    bookingId: text('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    membershipId: text('membership_id').references(() => memberships.id, { onDelete: 'set null' }),
    paymentId: text('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    amountPaise: integer('amount_paise'),
    message: text('message').notNull(),
    resolvedAt: timestamp('resolved_at'),
    resolvedBy: text('resolved_by').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: createdNow('created_at'),
  },
  (t) => [index('payment_issues_open_idx').on(t.resolvedAt, t.createdAt)],
);

// Admin pages grouped under one sidebar item, with a tab switch inside the page (like Bookings).
// The addresses stay the same as before, so links, alerts and search results keep working.

/** Enquiries & messages. Each tab needs its own permission; the group shows if either is allowed. */
export const INBOX = {
  label: 'Enquiries & messages',
  tabs: [
    { to: '/enquiries', label: 'Enquiries', permission: 'enquiries.manage' },
    { to: '/messages', label: 'Messages', permission: 'messages.manage' },
  ],
};

/** Customers & memberships. Plans & batches stays its own sidebar item. */
export const PEOPLE = {
  label: 'Customers & memberships',
  tabs: [
    { to: '/customers', label: 'Customers' },
    { to: '/memberships', label: 'Memberships', end: true },
  ],
};

/** True when `pathname` is one of the group's tabs (or a page inside a tab, unless the tab is `end`). */
export const inSection = (section, pathname) =>
  section.tabs.some(({ to, end }) => pathname === to || (!end && pathname.startsWith(`${to}/`)));

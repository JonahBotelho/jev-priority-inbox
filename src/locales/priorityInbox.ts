// Text for the public, read-only demo inbox.
export const priorityInboxText = {
  heading: 'Priority inbox',
  addressLabel: 'Inbox address',
  address: 'priority@example.test',
  addressHint: 'Placeholder address for the demo',
  description: 'Sample emails reviewed by Jev.',
  count: (total: number) => `${total} ${total === 1 ? 'message' : 'messages'}`,
  loading: 'Loading the inbox…',
  reviewing: 'Jev is reviewing sample emails…',
  unavailable: 'Jev review is unavailable. Previously reviewed emails appear here.',
  failed: 'Jev could not finish reviewing all sample emails.',
  empty: 'No emails were marked Emergency or Urgent.',
  loadError: 'The inbox could not be loaded.',
  retry: 'Try again',
};

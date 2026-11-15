// Website entry point for account connections and the optional sample inbox.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { en } from '../locales/en.js';
import { InboxApi } from './InboxApi.js';
import { MailboxReader } from './MailboxReader.js';
import { AccountMailbox } from './Mailbox.js';
import { MockMailbox } from './MockMailbox.js';
import './styles.css';

async function start() {
  const capabilities = await InboxApi.request<{ google?: boolean }>('/mode');
  const mailbox = window.location.pathname === '/demo' ? new MockMailbox() : new AccountMailbox();
  createRoot(document.getElementById('root')!).render(<React.StrictMode>
    <MailboxReader mailbox={mailbox} google={Boolean(capabilities.google)} />
  </React.StrictMode>);
}
void start().catch(() => {
  createRoot(document.getElementById('root')!).render(<main role="alert">{en.unavailable}</main>);
});

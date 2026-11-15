// Website entry point for account connections and the optional sample inbox.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { en } from '../locales/en.js';
import { InboxApi } from './InboxApi.js';
import { ConnectedReader } from './ConnectedReader.js';
import { DemoInbox } from './DemoInbox.js';
import './styles.css';

async function start() {
  if (window.location.pathname === '/demo') {
    createRoot(document.getElementById('root')!).render(<React.StrictMode><DemoInbox /></React.StrictMode>);
    return;
  }
  const capabilities = await InboxApi.request<{ google?: boolean }>('/mode');
  createRoot(document.getElementById('root')!).render(<React.StrictMode>
    <ConnectedReader google={Boolean(capabilities.google)} />
  </React.StrictMode>);
}
void start().catch(() => {
  createRoot(document.getElementById('root')!).render(<main role="alert">{en.unavailable}</main>);
});

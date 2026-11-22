// Inbox bookmarks stay public. Only explicit account routes load the portal.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { en } from '../locales/en.js';
import { PriorityInbox } from './PriorityInbox.js';

const path = window.location.pathname.replace(/\/+$/, '');
const portalPage = ['/login', '/register', '/app', '/admin'].includes(path);
const Portal = React.lazy(() => import('./Portal.js').then(module => ({ default: module.Portal })));
document.title = en.title;
createRoot(document.getElementById('root')!).render(<React.StrictMode>
  {portalPage ? <React.Suspense fallback={<main>{en.loading}</main>}><Portal path={path} /></React.Suspense> : <PriorityInbox />}
</React.StrictMode>);

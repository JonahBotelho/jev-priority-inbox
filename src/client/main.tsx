// The public demo uses the same inbox on every client entry route.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { en } from '../locales/en.js';
import { PriorityInbox } from './PriorityInbox.js';

document.title = en.title;
createRoot(document.getElementById('root')!).render(<React.StrictMode><PriorityInbox /></React.StrictMode>);

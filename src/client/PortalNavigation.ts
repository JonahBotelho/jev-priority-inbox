// Choose the destination after account creation, sign-in, or a visit with an existing session.
import type { PortalRole } from '../shared/portal.js';

export function signedInDestination(path: string, role: PortalRole, accountCreated = false): string {
  if (path === '/register' && accountCreated && role === 'user') return '/';
  if (path === '/login' || path === '/register') return role === 'admin' ? '/admin' : '/app';
  if (path === '/admin' && role !== 'admin') return '/app';
  return path;
}

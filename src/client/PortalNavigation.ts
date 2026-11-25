// Choose the destination after account creation, sign-in, or a visit with an existing session.
import type { PortalRole } from '../shared/portal.js';

export function signedInDestination(path: string, role: PortalRole): string {
  if (path === '/login' || path === '/register') return role === 'admin' ? '/admin' : '/';
  if (path === '/admin' && role !== 'admin') return '/app';
  return path;
}

// Choose the destination after sign-in or when a signed-in visitor opens a portal route.
import type { PortalRole } from '../shared/portal.js';

export function signedInDestination(path: string, role: PortalRole): string {
  if (path === '/login' || path === '/register') return role === 'admin' ? '/admin' : '/app';
  if (path === '/admin' && role !== 'admin') return '/app';
  return path;
}

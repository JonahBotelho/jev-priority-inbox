// JSON returned to authenticated portal visitors.
import type { Tier } from './types.js';

export type PortalRole = 'user' | 'admin';
export interface PortalUser { id: string; email: string; role: PortalRole }
export interface PortalUsage {
  requests: number;
  successful: number;
  lastRequest: string | null;
  netlifyCreditBalance: { remaining: string; checkedAt: string } | null;
}
export interface PortalDecision { id: string; tier: Tier; score: number; model: string; durationMs: number; provider: 'Jev' }
export interface PortalHistory { id: string; tier: Tier; score: number; model: string; createdAt: string }
export interface PortalDashboard {
  users: (PortalUser & { createdAt: string; requests: number })[];
}

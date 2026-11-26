// JSON returned to authenticated portal visitors.
import type { Probabilities, Tier } from './types.js';
import { PriorityPolicy } from './PriorityPolicy.js';

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
export interface DemoAttempt {
  id: string;
  userId: string;
  createdAt: string;
  durationMs: number;
}
export interface DemoInference extends DemoAttempt {
  model: string;
  probabilities: Probabilities;
  inputTokens: number | null;
  outputTokens: number | null;
}
export interface DemoReceipt { inference: DemoInference; signature: string }
export interface PortalDashboard {
  users: (PortalUser & { createdAt: string; requests: number })[];
}

export function demoHistoryEntry({ id, createdAt, model, probabilities }: DemoInference): PortalHistory {
  const { tier, score } = new PriorityPolicy().decide(probabilities);
  return { id, createdAt, model, tier, score: Math.round(score) };
}

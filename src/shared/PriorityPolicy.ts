// The live inbox and the browser demo use the same admission thresholds and priority score.
import { readUrgencyProbabilities } from './jev.js';
import type { Probabilities, Tier } from './types.js';

export class PriorityPolicy {
  decide(probabilities: Probabilities): { tier: Tier; score: number } {
    const { Emergency: emergency, Urgent: urgent } = readUrgencyProbabilities(probabilities);
    const tier = emergency + urgent < 0.8 ? 'Routine' : emergency >= 0.75 ? 'Emergency' : 'Urgent';
    return { tier, score: 100 * (emergency + 0.5 * urgent) };
  }
}

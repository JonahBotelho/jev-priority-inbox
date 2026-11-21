// Admission thresholds and deterministic ordering from the feasibility study.
import { readUrgencyProbabilities } from '../../shared/jev.js';
import type { Probabilities, Tier } from '../../shared/types.js';

export class PriorityPolicy {
  decide(probabilities: Probabilities): { tier: Tier; score: number } {
    const { Emergency: emergency, Urgent: urgent } = readUrgencyProbabilities(probabilities);
    const tier = emergency + urgent < 0.8 ? 'Routine' : emergency >= 0.75 ? 'Emergency' : 'Urgent';
    return { tier, score: 100 * (emergency + 0.5 * urgent) };
  }
}

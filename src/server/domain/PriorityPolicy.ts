// Admission thresholds and deterministic ordering from the feasibility study.
import type { Probabilities, Tier } from '../../shared/types.js';

export class PriorityPolicy {
  decide(probabilities: Probabilities): { tier: Tier; score: number } {
    const values = ['Emergency', 'Urgent', 'Routine'].map(key => probabilities[key as Tier]);
    if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1)
      || Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 0.01) {
      throw new Error('Invalid urgency probabilities');
    }
    const { Emergency: emergency, Urgent: urgent } = probabilities;
    const tier = emergency + urgent < 0.8 ? 'Routine' : emergency >= 0.75 ? 'Emergency' : 'Urgent';
    return { tier, score: 100 * (emergency + 0.5 * urgent) };
  }
}

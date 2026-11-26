// Jev's native System One API. Credentials and the fixed question stay on the inference host.
import { choice, TypeSafeClient } from '@typesafe-ai/sdk';
import { jevModel, readUrgencyProbabilities, urgencyRubric } from '../../shared/jev.js';
import type { ClassificationInput, Probabilities } from '../../shared/types.js';
import type { Classifier } from './Providers.js';

export class TypeSafeJev implements Classifier {
  private readonly client: TypeSafeClient;

  constructor(apiKey: string, baseURL = 'https://api.typesafe.ai') {
    this.client = new TypeSafeClient({
      apiKey, baseURL, compression: false, logLevel: 'off', timeout: 4000, retry: { maxRetries: 0 },
    });
  }

  async classify(input: ClassificationInput, signal: AbortSignal): Promise<Probabilities> {
    return (await this.infer(input, signal)).probabilities;
  }

  async infer(input: ClassificationInput, signal: AbortSignal) {
    const result = await this.client.systemOne({
      model: jevModel,
      state: { ...input },
      questions: { urgency: choice(urgencyRubric, { Emergency: null, Urgent: null, Routine: null }) },
    }, { signal });
    if (result.model !== jevModel) throw new Error('Unexpected Jev model');
    return {
      model: result.model,
      probabilities: readUrgencyProbabilities(result.answers.urgency.probabilities),
      inputTokens: result.usage?.input_tokens ?? null,
      outputTokens: result.usage?.output_tokens ?? null,
    };
  }
}

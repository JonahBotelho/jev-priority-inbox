// Authenticated server-to-server endpoint for a single urgency decision through Netlify AI Gateway.
import { timingSafeEqual } from 'node:crypto';
import { choice, RateLimitError, TypeSafeClient } from '@typesafe-ai/sdk';
import { jevModel, readClassificationInput, readUrgencyProbabilities, urgencyRubric } from '../../src/shared/jev.js';

function acceptsToken(request: Request, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(request.headers.get('Authorization') ?? '');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export default async function classify(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  const secret = process.env.JEV_FUNCTION_SECRET?.trim();
  if (!secret) return new Response(null, { status: 503 });
  if (!acceptsToken(request, secret)) return new Response(null, { status: 401 });

  const input = readClassificationInput(await request.json().catch(() => undefined));
  if (!input) return new Response(null, { status: 400 });

  // Both values are injected together. Require the gateway URL before making a billable request.
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  const baseURL = process.env.TYPESAFE_BASE_URL?.trim();
  if (!apiKey || !baseURL) return new Response(null, { status: 503 });
  try {
    const client = new TypeSafeClient({
      apiKey, baseURL, compression: false, logLevel: 'off', timeout: 4000, retry: { maxRetries: 0 },
    });
    const result = await client.systemOne({
      model: jevModel,
      state: { ...input },
      questions: { urgency: choice(urgencyRubric, { Emergency: null, Urgent: null, Routine: null }) },
    }, { signal: request.signal });
    if (result.model !== jevModel) return new Response(null, { status: 502 });
    const probabilities = readUrgencyProbabilities(result.answers.urgency.probabilities);
    return Response.json(probabilities, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return new Response(null, { status: error instanceof RateLimitError ? 429 : 502 });
  }
}

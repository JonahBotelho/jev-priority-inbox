// Authenticated server-to-server endpoint for a single urgency decision through Netlify AI Gateway.
import { timingSafeEqual } from 'node:crypto';
import { RateLimitError } from '@typesafe-ai/sdk';
import { readClassificationInput } from '../../src/shared/jev.js';
import { TypeSafeJev } from '../../src/server/adapters/TypeSafeJev.js';

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
    const probabilities = await new TypeSafeJev(apiKey, baseURL).classify(input, request.signal);
    return Response.json(probabilities, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return new Response(null, { status: error instanceof RateLimitError ? 429 : 502 });
  }
}

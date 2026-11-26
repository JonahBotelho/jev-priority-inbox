// Small uncached study comparison. Each provider gets one attempt per approved example.
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { JevClassifier } from '../server/adapters/Providers.js';
import { Fixtures } from '../server/adapters/Fixtures.js';
import { PriorityPolicy } from '../shared/PriorityPolicy.js';
import { en } from '../locales/en.js';
import { urgencyRubric } from '../shared/jev.js';

class Comparison {
  static async run(): Promise<void> {
    const jev = JevClassifier.fromEnvironment();
    if (!jev || !process.env.GEMINI_API_KEY) throw new Error(en.comparisonKey);
    const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: 4000, retryOptions: { attempts: 1 } } });
    const receivedAt = new Date().toISOString();
    for (const name of Fixtures.names) {
      const input = { ...Fixtures.get(name), receivedAt, role: process.env.RECIPIENT_ROLE ?? 'On-call service owner', timeZone: process.env.RECIPIENT_TIME_ZONE ?? 'America/Vancouver' };
      const report: Record<string, unknown> = { example: name, expected: Fixtures.expected(name), receivedAt };
      let started = performance.now();
      try {
        const scores = await jev.classify(input, AbortSignal.timeout(4000));
        report.jev = { leading: Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0], display: new PriorityPolicy().decide(scores).tier };
      } catch { report.jev = en.comparisonFailed; }
      report.jevMilliseconds = Math.round(performance.now() - started);
      started = performance.now();
      try {
        const response = await gemini.models.generateContent({ model: 'gemini-3.1-flash-lite', contents: JSON.stringify(input),
          config: { systemInstruction: urgencyRubric, responseMimeType: 'application/json',
            responseJsonSchema: { type: 'object', properties: { tier: { type: 'string', enum: ['Emergency', 'Urgent', 'Routine'] } }, required: ['tier'] } } });
        const result = JSON.parse(response.text ?? '');
        if (!['Emergency', 'Urgent', 'Routine'].includes(result.tier)) throw new Error('Invalid tier');
        report.gemini = result.tier;
      } catch { report.gemini = en.comparisonFailed; }
      report.geminiMilliseconds = Math.round(performance.now() - started);
      console.log(JSON.stringify(report));
    }
  }
}

Comparison.run().catch(error => { console.error(error.message); process.exitCode = 1; });

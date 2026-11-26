// A visible demo checks for newer rows even when the user leaves a completed draft untouched.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { historyFreshnessMs, observeDemoHistory } from '../src/client/DemoHistoryRefresh.js';

test('history checks run while visible, resume once on return, and stop on unmount', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const page = Object.assign(new EventTarget(), { hidden: true });
  const check = t.mock.fn();
  const stop = observeDemoHistory(page, check);
  t.mock.timers.tick(historyFreshnessMs);
  assert.equal(check.mock.callCount(), 0);

  page.hidden = false;
  page.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(historyFreshnessMs);
  assert.equal(check.mock.callCount(), 2);
  page.hidden = true;
  page.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(4 * historyFreshnessMs);
  assert.equal(check.mock.callCount(), 2);

  page.hidden = false;
  page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(check.mock.callCount(), 3);
  stop();
  t.mock.timers.tick(historyFreshnessMs);
  page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(check.mock.callCount(), 3);
});

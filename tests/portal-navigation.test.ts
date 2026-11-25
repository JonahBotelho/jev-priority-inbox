// Verify portal destinations for each signed-in role.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signedInDestination } from '../src/client/PortalNavigation.js';

test('sign-in and registration open the public inbox for both roles', () => {
  for (const role of ['user', 'admin'] as const) {
    assert.equal(signedInDestination('/login', role), '/');
    assert.equal(signedInDestination('/register', role), '/');
  }
});

test('both roles can open the demo and only administrators can open the directory', () => {
  assert.equal(signedInDestination('/app', 'user'), '/app');
  assert.equal(signedInDestination('/app', 'admin'), '/app');
  assert.equal(signedInDestination('/admin', 'user'), '/app');
  assert.equal(signedInDestination('/admin', 'admin'), '/admin');
});

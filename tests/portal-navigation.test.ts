// Verify portal destinations for each signed-in role.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signedInDestination } from '../src/client/PortalNavigation.js';

test('regular users land on the public inbox after sign-in and registration', () => {
  assert.equal(signedInDestination('/login', 'user'), '/');
  assert.equal(signedInDestination('/register', 'user'), '/');
});

test('administrators land on the directory from either authentication page', () => {
  assert.equal(signedInDestination('/login', 'admin'), '/admin');
  assert.equal(signedInDestination('/register', 'admin'), '/admin');
});

test('both roles can open the demo and only administrators can open the directory', () => {
  assert.equal(signedInDestination('/app', 'user'), '/app');
  assert.equal(signedInDestination('/app', 'admin'), '/app');
  assert.equal(signedInDestination('/admin', 'user'), '/app');
  assert.equal(signedInDestination('/admin', 'admin'), '/admin');
});

// Verify portal destinations for each signed-in role.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signedInDestination } from '../src/client/PortalNavigation.js';

test('a newly registered user lands on the public inbox', () => {
  assert.equal(signedInDestination('/register', 'user', true), '/');
});

test('existing accounts visiting sign-in or registration land on their role page', () => {
  for (const path of ['/login', '/register']) {
    assert.equal(signedInDestination(path, 'user'), '/app');
    assert.equal(signedInDestination(path, 'admin'), '/admin');
  }
});

test('both roles can open the demo and only administrators can open the directory', () => {
  assert.equal(signedInDestination('/app', 'user'), '/app');
  assert.equal(signedInDestination('/app', 'admin'), '/app');
  assert.equal(signedInDestination('/admin', 'user'), '/app');
  assert.equal(signedInDestination('/admin', 'admin'), '/admin');
});

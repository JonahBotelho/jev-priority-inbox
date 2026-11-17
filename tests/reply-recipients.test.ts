// Reply drafts preserve recipient roles without including self or duplicate addresses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReplyRecipients } from '../src/client/ReplyRecipients.js';
import type { MailDetail } from '../src/shared/mail.js';

const message: MailDetail = {
  subject: 'Question', text: '', receivedAt: '', from: 'Sender <sender@example.test>',
  replyTo: 'Reply Person <reply@example.test>',
  to: ['ME@example.test', 'colleague@example.test', 'REPLY@example.test'],
  cc: ['copy@example.test', 'COLLEAGUE@example.test', 'me@example.test', 'COPY@example.test'],
};

test('Reply targets Reply-To only; Reply all includes To and Cc without self or duplicates', () => {
  assert.deepEqual(ReplyRecipients.for(message, 'me@example.test', false), {
    to: 'reply@example.test', cc: '',
  });
  assert.deepEqual(ReplyRecipients.for(message, 'me@example.test', true), {
    to: 'reply@example.test, colleague@example.test', cc: 'copy@example.test',
  });
});

test('replies fall back to From and tolerate messages without recipient headers', () => {
  const source = { ...message, replyTo: undefined, to: undefined, cc: undefined };
  assert.deepEqual(ReplyRecipients.for(source, 'me@example.test', true), { to: 'sender@example.test', cc: '' });
  assert.deepEqual(ReplyRecipients.for(source, 'sender@example.test', true), { to: '', cc: '' });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { canOfferRetry } from '../lib/retry-policy.js';

test('non-interactive never offers retry', () => {
  assert.equal(canOfferRetry({
    nonInteractive: true,
    retryCount: 0,
    maxRetries: 3
  }), false);
});

test('interactive offers retry until max reached', () => {
  assert.equal(canOfferRetry({
    nonInteractive: false,
    retryCount: 0,
    maxRetries: 2
  }), true);
  assert.equal(canOfferRetry({
    nonInteractive: false,
    retryCount: 2,
    maxRetries: 2
  }), false);
});

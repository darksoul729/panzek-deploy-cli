import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTunnelName,
  validateCloudflareHostname,
  validateUrl
} from '../lib/cloudflare-validators.js';

test('validateTunnelName accepts safe names', () => {
  assert.equal(validateTunnelName('panzek-tunnel_1.main'), undefined);
});

test('validateTunnelName rejects whitespace', () => {
  assert.match(
    validateTunnelName('bad name'),
    /hanya boleh berisi/
  );
});

test('validateCloudflareHostname requires fqdn', () => {
  assert.match(
    validateCloudflareHostname('localhost'),
    /subdomain atau domain penuh/
  );
});

test('validateUrl only accepts http/https', () => {
  assert.match(validateUrl('tcp://localhost:80', 'URL service lokal'), /harus memakai http/);
  assert.equal(validateUrl('https://example.com', 'URL service lokal'), undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRuntimeOptions } from '../lib/runtime-options.js';

test('parseRuntimeOptions parses non-interactive action and mode', () => {
  const parsed = parseRuntimeOptions([
    '--action', 'preflight',
    '--non-interactive',
    '--mode', 'dry-run',
    '--max-retries', '5',
    '--theme', 'ocean',
    '--output', 'json',
    '--no-color'
  ]);

  assert.equal(parsed.action, 'preflight');
  assert.equal(parsed.nonInteractive, true);
  assert.equal(parsed.mode, 'dry-run');
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.maxRetries, 5);
  assert.equal(parsed.theme, 'ocean');
  assert.equal(parsed.output, 'json');
  assert.equal(parsed.noColor, true);
});

test('parseRuntimeOptions keeps defaults', () => {
  const parsed = parseRuntimeOptions([]);
  assert.equal(parsed.mode, '');
  assert.equal(parsed.dryRun, false);
  assert.equal(parsed.maxRetries, 3);
  assert.equal(parsed.theme, 'amber');
  assert.equal(parsed.previewTheme, false);
  assert.equal(parsed.output, 'table');
  assert.equal(parsed.noColor, false);
});

test('parseRuntimeOptions rejects invalid mode', () => {
  assert.throws(
    () => parseRuntimeOptions(['--mode', 'preview']),
    /Mode tidak valid/
  );
});

test('parseRuntimeOptions rejects invalid theme', () => {
  assert.throws(
    () => parseRuntimeOptions(['--theme', 'neon']),
    /Theme tidak valid/
  );
});

test('parseRuntimeOptions supports auto theme and preview-theme', () => {
  const parsed = parseRuntimeOptions(['--theme', 'auto', '--preview-theme']);
  assert.equal(parsed.theme, 'auto');
  assert.equal(parsed.previewTheme, true);
});

test('parseRuntimeOptions rejects invalid output', () => {
  assert.throws(
    () => parseRuntimeOptions(['--output', 'yaml']),
    /Output tidak valid/
  );
});

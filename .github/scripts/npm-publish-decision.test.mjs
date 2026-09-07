import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkRegistryVersion, classifyRegistryResult } from './npm-publish-decision.mjs';

test('skips an already published exact version', () => {
  assert.deepEqual(
    classifyRegistryResult({ status: 0, stdout: '"0.2.0"', stderr: '' }),
    { action: 'skip', publish: false, reason: 'already-published' },
  );
});

test('publishes only when npm returns exact E404', () => {
  assert.deepEqual(
    classifyRegistryResult({
      status: 1,
      stdout: '',
      stderr: 'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@tracekit%2fbrowser - Not found',
    }),
    { action: 'publish', publish: true, reason: 'exact-version-not-found' },
  );
});

test('fails closed for authentication errors', () => {
  assert.deepEqual(
    classifyRegistryResult({ status: 1, stdout: '', stderr: 'npm error code E401' }),
    { action: 'fail', publish: false, reason: 'registry-lookup-failed' },
  );
});

test('fails closed for network errors', () => {
  assert.deepEqual(
    classifyRegistryResult({ status: 1, stdout: '', stderr: 'npm error code ENETUNREACH' }),
    { action: 'fail', publish: false, reason: 'registry-lookup-failed' },
  );
});

test('queries the exact package and version', () => {
  let command;
  const decision = checkRegistryVersion('@tracekit/browser', '0.2.0', (...args) => {
    command = args;
    return { status: 0, stdout: '"0.2.0"', stderr: '' };
  });

  assert.equal(decision.action, 'skip');
  assert.deepEqual(command.slice(0, 2), ['npm', ['view', '@tracekit/browser@0.2.0', 'version', '--json']]);
});

test('manual dispatch cannot publish from a non-main ref', () => {
  const workflow = readFileSync(new URL('../workflows/publish.yml', import.meta.url), 'utf8');
  assert.match(workflow, /if:\s*github\.ref\s*==\s*'refs\/heads\/main'/);
  assert.match(workflow, /group:\s*browser-npm-publication\s*\n\s*cancel-in-progress:\s*false/);
});

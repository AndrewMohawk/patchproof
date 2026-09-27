import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneJsonData } from '../packages/contracts/src/json-data.ts';
import { FunctionCaseSchema } from '../packages/contracts/src/product.ts';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { evaluateObservation } from '../workers/sandbox/index.ts';

// Invented in-memory JSON only; no candidates, private corpus, interpreters or transports.
const keys = ['constructor', '__proto__', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', '__defineGetter__', 'isPrototypeOf', '', '0', '01', '4294967295', '\u0000', '\ud800', '日本語', '😀'];
const leaves = [null, true, false, 0, -0, Number.MAX_VALUE, Number.MIN_VALUE, '', '\u0000', '\ud800', '😀'];
const object = (entries: Array<[string, unknown]>) => Object.fromEntries(entries);

test('independent unusual-key metadata corpus retains every key and detects a key-only observation change', () => {
  for (let index = 0; index < 64; index++) {
    const value = object(keys.map((key, position) => [key, [leaves[(index + position) % leaves.length], object([[keys[(position + index + 1) % keys.length]!, leaves[(position + 3) % leaves.length]]])]]));
    const copied = cloneJsonData(value);
    assert.deepEqual(copied, value);
    assert.deepEqual(Object.keys(copied as object), Object.keys(value));
    assert.equal(Object.getPrototypeOf(copied), Object.prototype);
    assert.equal(digestJson(copied), digestJson(value));
    const jsonValue = JSON.parse(JSON.stringify(value));
    const check = FunctionCaseSchema.parse({ id: 'metadata-control', requirementId: 'R01', function: 'identity', args: [jsonValue], kwargs: jsonValue, assertArgsUnchanged: true, expected: jsonValue });
    const observation = { kind: 'return', value: jsonValue, argsAfter: check.args, kwargsAfter: check.kwargs };
    assert.equal(evaluateObservation(check, JSON.stringify(observation), 0, '2.2').status, 'pass');
    for (const removed of ['constructor', '__proto__']) {
      const changed = structuredClone(observation); delete changed.value[removed];
      assert.equal(evaluateObservation(check, JSON.stringify(changed), 0, '2.2').status, 'fail');
    }
    for (const version of ['2.0', '2.1'] as const) {
      assert.equal(evaluateObservation(check, JSON.stringify(observation), 0, version).message, 'unsupported_legacy_json_key');
    }
  }
});

test('strict case envelopes reject an extra reserved name rather than silently omitting it', () => {
  for (const key of ['constructor', '__proto__', 'prototype']) {
    const input = object([['id', 'metadata-control'], ['requirementId', 'R01'], ['function', 'identity'], ['args', []], ['expected', 1], [key, { sentinel: true }]]);
    assert.equal(FunctionCaseSchema.safeParse(input).success, false, key);
  }
});

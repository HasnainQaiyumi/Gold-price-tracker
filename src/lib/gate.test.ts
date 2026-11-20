import test from 'node:test';
import assert from 'node:assert/strict';
import { derive, GATE, verifyPassword, type GateConfig } from './gate';

// Test with a throwaway password so the real one never appears in the repository.
async function makeCfg(pw: string): Promise<GateConfig> {
  const salt = Buffer.from('0123456789abcdef').toString('base64');
  const h = await derive(pw, salt, 1000);
  return { salt, hash: Buffer.from(h).toString('base64'), iterations: 1000 };
}

test('verifyPassword accepts the right password and rejects wrong/empty ones', async () => {
  const cfg = await makeCfg('test-only-password');
  assert.equal(await verifyPassword('test-only-password', cfg), true);
  assert.equal(await verifyPassword('test-only-passworD', cfg), false);
  assert.equal(await verifyPassword('', cfg), false);
});

test('shipped config is well-formed and never contains a plaintext password', () => {
  assert.ok(GATE.iterations >= 600000);
  assert.equal(Buffer.from(GATE.hash, 'base64').length, 32);
  assert.ok(Buffer.from(GATE.salt, 'base64').length >= 16);
});

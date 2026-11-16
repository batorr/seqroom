import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { clientAddress, trustProxyFromEnv, isCloudflare, normalizeAddress } = require('../lib/client-ip.js');

const behindProxy = { trustProxy: true };
const CF_EDGE = '172.70.1.2'; // inside 172.64.0.0/13
const RENDER_PROXY = '10.210.4.7';

test('without a trusted proxy the connection address is used and headers are ignored', () => {
  const handshake = { address: '::ffff:203.0.113.9', headers: { 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '5.6.7.8' } };
  assert.equal(clientAddress(handshake), '203.0.113.9');
});

test('behind Render via Cloudflare, CF-Connecting-IP names the visitor', () => {
  const handshake = {
    address: RENDER_PROXY,
    headers: { 'x-forwarded-for': `198.51.100.23, ${CF_EDGE}`, 'cf-connecting-ip': '198.51.100.23' },
  };
  assert.equal(clientAddress(handshake, behindProxy), '198.51.100.23');
});

test('a forged CF-Connecting-IP sent straight to onrender.com is ignored', () => {
  const handshake = {
    address: RENDER_PROXY,
    headers: { 'x-forwarded-for': '9.9.9.9, 203.0.113.50', 'cf-connecting-ip': '9.9.9.9' },
  };
  // The last hop is the address that really connected to Render.
  assert.equal(clientAddress(handshake, behindProxy), '203.0.113.50');
});

test('a forged left part of X-Forwarded-For does not matter', () => {
  const handshake = { address: RENDER_PROXY, headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.77' } };
  assert.equal(clientAddress(handshake, behindProxy), '203.0.113.77');
});

test('IPv6 visitors and Cloudflare IPv6 edges work too', () => {
  const handshake = {
    address: RENDER_PROXY,
    headers: { 'x-forwarded-for': '2a06:98c0:3600::103', 'cf-connecting-ip': '2001:db8::42' },
  };
  assert.equal(clientAddress(handshake, behindProxy), '2001:db8::42');
});

test('garbage headers fall back to the connection address', () => {
  const handshake = { address: '::ffff:192.0.2.1', headers: { 'x-forwarded-for': 'not-an-ip', 'cf-connecting-ip': '<script>' } };
  assert.equal(clientAddress(handshake, behindProxy), '192.0.2.1');
  assert.equal(clientAddress({}, behindProxy), 'unknown');
});

test('Cloudflare ranges and address normalising', () => {
  assert.equal(isCloudflare('104.16.0.1'), true);
  assert.equal(isCloudflare('131.0.75.255'), true);
  assert.equal(isCloudflare('8.8.8.8'), false);
  assert.equal(isCloudflare('2606:4700::1'), true);
  assert.equal(isCloudflare('2001:db8::1'), false);
  assert.equal(normalizeAddress('::ffff:10.0.0.1'), '10.0.0.1');
  assert.equal(normalizeAddress(' 2001:db8::1 '), '2001:db8::1');
  assert.equal(normalizeAddress('hello'), '');
});

test('the proxy is trusted on Render or when TRUST_PROXY is set', () => {
  assert.equal(trustProxyFromEnv({ RENDER: 'true' }), true);
  assert.equal(trustProxyFromEnv({ TRUST_PROXY: '1' }), true);
  assert.equal(trustProxyFromEnv({}), false);
  assert.equal(trustProxyFromEnv({ TRUST_PROXY: '0' }), false);
});

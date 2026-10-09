import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform, Writable } from 'node:stream';
import { parseByteRange } from '../http-range.js';

test('byte ranges support normal seek, suffix, and oversized end', () => {
  assert.deepEqual(parseByteRange('bytes=20-', 100), { start: 20, end: 99 });
  assert.deepEqual(parseByteRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange('bytes=20-200', 100), { start: 20, end: 99 });
});

test('invalid ranges do not reach a file stream', () => {
  for (const header of ['bytes=-', 'bytes=-0', 'bytes=100-', 'bytes=20-10', 'bytes=0-1,4-5', 'garbage']) {
    assert.equal(parseByteRange(header, 100), null, header);
  }
  assert.equal(parseByteRange('bytes=0-', 0), null);
});

test('missing auth config retains initial setup; damaged config denies access', () => {
  const source = fs.readFileSync(new URL('../api-handler.js', import.meta.url), 'utf8');
  const functions = source.slice(source.indexOf('function loadAuthConfig()'), source.indexOf('function hashPassword('));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'faraday-auth-test-'));
  const configPath = path.join(dir, 'auth.json');
  const context = vm.createContext({ fs, AUTH_CONFIG_PATH: configPath, console: { warn() {} } });
  vm.runInContext(functions, context);
  try {
    assert.equal(context.loadAuthConfig().enabled, false);
    fs.writeFileSync(configPath, '{broken');
    assert.equal(context.loadAuthConfig().loadError, true);
    assert.equal(context.loadAuthConfig().enabled, true);
    fs.writeFileSync(configPath, JSON.stringify({ enabled: true, sessions: {} }));
    assert.equal(context.loadAuthConfig().loadError, true);
    assert.equal(context.saveAuthConfig({ enabled: true, sessions: [], accessLogs: [] }), true);
    assert.equal(context.loadAuthConfig().enabled, true);
    assert.equal(fs.existsSync(`${configPath}.tmp`), false);
    context.fs = { ...fs, renameSync() { throw new Error('disk error'); } };
    assert.equal(context.saveAuthConfig({ enabled: false, sessions: [], accessLogs: [] }), false);
    assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).enabled, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('malformed cookies cannot crash authenticated requests', () => {
  const source = fs.readFileSync(new URL('../api-handler.js', import.meta.url), 'utf8');
  const start = source.indexOf('function parseCookies(');
  const end = source.indexOf('\n}', start) + 2;
  const context = vm.createContext({});
  vm.runInContext(source.slice(start, end), context);
  const cookies = context.parseCookies('broken=%ZZ; bf_session=valid-token');
  assert.equal(cookies.bf_session, 'valid-token');
  assert.equal(cookies.broken, undefined);
});

test('harvest write errors reject and clean temporary output instead of crashing', async () => {
  const source = fs.readFileSync(new URL('../api-handler.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function harvestDownload(');
  const end = source.indexOf('\n}', start) + 2;
  let removed = false;
  const context = vm.createContext({
    path, process: { pid: 1 }, Math, Error, AbortSignal, Readable, Transform, pipeline,
    isPathWithin: () => true, HARVEST_MAX_BYTES: 1024,
    fs: {
      createWriteStream: () => new Writable({ write(chunk, encoding, callback) { callback(new Error('disk full')); } }),
      unlinkSync: () => { removed = true; },
    },
    fetch: async () => new Response(new Uint8Array(128)),
  });
  vm.runInContext(source.slice(start, end), context);
  await assert.rejects(context.harvestDownload('https://cdn.example/video', '/tmp', 'video.mp4'), /disk full/);
  assert.equal(removed, true);
});

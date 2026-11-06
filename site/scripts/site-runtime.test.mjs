import assert from 'node:assert/strict';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLocalSiteRuntime, isolatedRuntimeEnvironment, localRuntimeConfig, ownedRuntimeReady } from './site-runtime.mjs';

const built = {
  main: 'index.js', no_bundle: true, compatibility_date: '2026-10-23', compatibility_flags: ['nodejs_compat'],
  assets: { directory: '../client' }, vars: {},
  d1_databases: [{ binding: 'DB', database_name: 'site-creator-d1', database_id: '00000000-0000-4000-8000-000000000000' }],
  r2_buckets: [{ binding: 'BUCKET', bucket_name: 'site-creator-r2' }],
};

test('runtime config uses only fixed local placeholder D1/R2 and loopback bindings', () => {
  const config = localRuntimeConfig(built, '/fixture/dist/server', '/fixture/dist/client');
  assert.equal(config.d1_databases[0].database_id, '00000000-0000-4000-8000-000000000001');
  assert.equal(config.d1_databases[0].remote, false);
  assert.equal(config.r2_buckets[0].remote, false);
  assert.equal(config.dev.ip, '127.0.0.1');
  assert.equal(config.dev.inspector_ip, '127.0.0.1');
  assert.equal(config.account_id, undefined);
  assert.equal(config.main, '/fixture/dist/server/index.js');
});

test('runtime guard refuses remote or real-resource configs before launching Wrangler', () => {
  for (const change of [
    { d1_databases: [{ ...built.d1_databases[0], remote: true }] },
    { r2_buckets: [{ ...built.r2_buckets[0], remote: true }] },
    { d1_databases: [{ ...built.d1_databases[0], database_id: 'production-id' }] },
    { r2_buckets: [{ binding: 'BUCKET', bucket_name: 'production-bucket' }] },
    { account_id: 'production-account' }, { vars: { SECRET: 'must-not-inherit' } },
    { services: [{ binding: 'SERVICE', service: 'production' }] },
    { main: '../../other.js' }, { assets: { directory: '/production/assets' } },
  ]) assert.throws(() => localRuntimeConfig({ ...built, ...change }, '/fixture/dist/server', '/fixture/dist/client'));
});

test('child environment cannot inherit cloud credentials, developer config or execution hooks', () => {
  const env = isolatedRuntimeEnvironment('/isolated', {
    PATH: '/node/bin', HOME: '/developer', NODE_OPTIONS: '--require secret.js',
    CLOUDFLARE_API_TOKEN: 'must-not-inherit', CLOUDFLARE_ACCOUNT_ID: 'must-not-inherit',
    SITES_TOKEN: 'must-not-inherit', HTTPS_PROXY: 'must-not-inherit', XDG_CONFIG_HOME: '/developer/config',
  });
  assert.equal(env.PATH, '/node/bin');
  assert.equal(env.HOME, '/isolated/home');
  assert.equal(env.XDG_CONFIG_HOME, '/isolated/config');
  for (const key of ['NODE_OPTIONS', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'SITES_TOKEN', 'HTTPS_PROXY']) assert.equal(env[key], undefined);
  assert.equal(env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV, 'false');
  assert.equal(env.WRANGLER_SEND_METRICS, 'false');
});

test('readiness requires the owned Wrangler IPC event and exact loopback port', () => {
  assert.equal(ownedRuntimeReady(JSON.stringify({ event: 'DEV_SERVER_READY', ip: '127.0.0.1', port: 4175 }), 4175), true);
  for (const value of [
    { event: 'DEV_SERVER_READY', ip: '127.0.0.1', port: 4176 },
    { event: 'DEV_SERVER_READY', ip: '0.0.0.0', port: 4175 },
    { event: 'OTHER', ip: '127.0.0.1', port: 4175 }, 'Ready on http://127.0.0.1:4175', null,
  ]) assert.equal(ownedRuntimeReady(value, 4175), false);
});

test('an occupied harmless server is rejected without HTTP requests or spawning Wrangler', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inventory-runtime-occupied-'));
  let requests = 0;
  const server = createServer((_, response) => { requests += 1; response.setHeader('Content-Type', 'application/json'); response.end('{"items":[]}'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await mkdir(join(root, 'dist/server'), { recursive: true });
    await mkdir(join(root, 'dist/client'), { recursive: true });
    await mkdir(join(root, 'node_modules/wrangler/bin'), { recursive: true });
    await writeFile(join(root, 'dist/server/wrangler.json'), JSON.stringify(built));
    await writeFile(join(root, 'dist/server/index.js'), 'export default {};');
    const marker = join(root, 'must-not-launch');
    await writeFile(join(root, 'node_modules/wrangler/bin/wrangler.js'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'launched');`);
    await assert.rejects(createLocalSiteRuntime({ siteRoot: root, port: server.address().port }), { code: 'EADDRINUSE' });
    assert.equal(requests, 0);
    await assert.rejects(access(marker), { code: 'ENOENT' });
  } finally {
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  }
});

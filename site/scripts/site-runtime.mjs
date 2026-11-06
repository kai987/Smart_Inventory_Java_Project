import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const placeholderId = '00000000-0000-4000-8000-000000000000';
const localId = '00000000-0000-4000-8000-000000000001';
const databaseName = 'smart-inventory-runtime-test';

function containsRemote(value) {
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => key === 'remote' && item === true || containsRemote(item));
}

/** Reject a production/remote config; construct a new local-only allowlist. */
export function localRuntimeConfig(built, serverDirectory, clientDirectory) {
  assert.equal(containsRemote(built), false, 'Runtime tests refuse remote bindings.');
  assert.equal(built.account_id, undefined, 'Runtime tests refuse account credentials.');
  assert.deepEqual(built.vars ?? {}, {}, 'Runtime tests refuse deployed variables.');
  assert.equal(built.main, 'index.js');
  assert.equal(built.no_bundle, true);
  assert.equal(built.d1_databases?.length, 1);
  assert.equal(built.d1_databases[0].binding, 'DB');
  assert.equal(built.d1_databases[0].database_name, 'site-creator-d1');
  assert.equal(built.d1_databases[0].database_id, placeholderId, 'Expected a build-time placeholder database.');
  assert.equal(built.r2_buckets?.length, 1);
  assert.equal(built.r2_buckets[0].binding, 'BUCKET');
  assert.equal(built.r2_buckets[0].bucket_name, 'site-creator-r2', 'Expected a build-time placeholder bucket.');
  for (const key of ['services', 'kv_namespaces', 'hyperdrive', 'vectorize', 'workflows', 'pipelines', 'secrets_store_secrets', 'dispatch_namespaces']) {
    assert.deepEqual(built[key] ?? [], [], `Unexpected ${key} binding.`);
  }
  assert.deepEqual(built.durable_objects?.bindings ?? [], []);
  assert.deepEqual(built.queues?.producers ?? [], []);
  assert.deepEqual(built.queues?.consumers ?? [], []);
  assert.match(built.compatibility_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(built.compatibility_flags, ['nodejs_compat']);
  assert.equal(resolve(serverDirectory, built.assets?.directory ?? ''), clientDirectory);
  return {
    name: databaseName,
    main: join(serverDirectory, 'index.js'),
    compatibility_date: built.compatibility_date,
    compatibility_flags: built.compatibility_flags,
    no_bundle: true,
    rules: [{ type: 'ESModule', globs: ['**/*.js', '**/*.mjs'] }],
    assets: { directory: clientDirectory },
    d1_databases: [{ binding: 'DB', database_name: databaseName, database_id: localId, remote: false }],
    r2_buckets: [{ binding: 'BUCKET', bucket_name: databaseName, remote: false }],
    dev: { ip: '127.0.0.1', local_protocol: 'http', inspector_ip: '127.0.0.1', enable_containers: false },
    vars: {},
  };
}

export function isolatedRuntimeEnvironment(directory, inherited = process.env) {
  // In particular, do not pass Cloudflare/Sites credentials, NODE_OPTIONS,
  // proxies, or the developer's HOME/configuration to any child process.
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL']
    .filter((key) => inherited[key] !== undefined).map((key) => [key, inherited[key]]));
  return { ...env, HOME: join(directory, 'home'), XDG_CONFIG_HOME: join(directory, 'config'),
    XDG_CACHE_HOME: join(directory, 'cache'), CI: 'true', NO_COLOR: '1',
    WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    WRANGLER_LOG_PATH: join(directory, 'wrangler.log') };
}

export function ownedRuntimeReady(message, port) {
  try {
    const value = typeof message === 'string' ? JSON.parse(message) : message;
    return value?.event === 'DEV_SERVER_READY' && value.ip === '127.0.0.1' && value.port === port;
  } catch { return false; }
}

async function availablePort(requested = 0) {
  const server = createServer();
  server.listen(requested, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
  return port;
}

export async function createLocalSiteRuntime({ siteRoot = defaultRoot, port } = {}) {
  siteRoot = await realpath(siteRoot);
  const serverDirectory = join(siteRoot, 'dist/server');
  const clientDirectory = join(siteRoot, 'dist/client');
  const built = JSON.parse(await readFile(join(serverDirectory, 'wrangler.json'), 'utf8'));
  const config = localRuntimeConfig(built, serverDirectory, clientDirectory);
  await realpath(config.main);
  await realpath(clientDirectory);
  const wrangler = join(siteRoot, 'node_modules/wrangler/bin/wrangler.js');
  await realpath(wrangler);
  if (port !== undefined) assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Use an unprivileged loopback port.');
  port = await availablePort(port ?? 0); // Refuse an occupied port before making any state.
  const directory = await mkdtemp(join(tmpdir(), 'smart-inventory-site-runtime-'));
  const env = isolatedRuntimeEnvironment(directory);
  const persist = join(directory, 'state');
  const configPath = join(directory, 'wrangler.json');
  const baseURL = `http://127.0.0.1:${port}`;
  let worker;
  let closed = false;
  let logs = '';
  const children = new Set();
  const append = (chunk) => { logs = (logs + chunk).slice(-16_000); };
  function child(args, ipc = false) {
    const processChild = spawn(process.execPath, [wrangler, ...args], {
      cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe', ...(ipc ? ['ipc'] : [])], detached: process.platform !== 'win32',
    });
    children.add(processChild);
    processChild.stdout.on('data', append);
    processChild.stderr.on('data', append);
    processChild.once('close', () => children.delete(processChild));
    return processChild;
  }
  async function stopChild(processChild) {
    if (!processChild?.pid || processChild.exitCode !== null || processChild.signalCode !== null) return;
    const signal = (name) => {
      try { if (process.platform === 'win32') processChild.kill(name); else process.kill(-processChild.pid, name); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const finished = once(processChild, 'close');
    signal('SIGTERM');
    if (await Promise.race([finished.then(() => true), delay(5000, undefined, { ref: false }).then(() => false)])) return;
    signal('SIGKILL');
    await finished;
  }
  async function run(args) {
    const processChild = child(args);
    let stdout = '';
    processChild.stdout.on('data', (chunk) => { stdout += chunk; });
    const timeout = setTimeout(() => { void stopChild(processChild); }, 60_000);
    const [code] = await once(processChild, 'close').finally(() => clearTimeout(timeout));
    assert.equal(code, 0, `Local Wrangler ${args[0]} failed.\n${logs}`);
    return stdout;
  }
  async function execute(sql) {
    assert.equal(closed, false, 'Runtime is closed.');
    const output = await run(['d1', 'execute', 'DB', '--config', configPath, '--local', '--persist-to', persist, '--json', '--command', sql]);
    const result = JSON.parse(output);
    assert.ok(result.every((item) => item.success), 'Local D1 command failed.');
    return result.flatMap((item) => item.results);
  }
  async function start() {
    assert.equal(closed, false, 'Runtime is closed.');
    assert.equal(worker, undefined, 'Worker already started.');
    await availablePort(port); // Also check each restart, immediately before launch.
    let owned = false;
    let startupLog = ''; // Never reuse a previous isolate's readiness evidence.
    worker = child(['dev', '--config', configPath, '--local', '--ip', '127.0.0.1', '--port', String(port),
      '--inspector-ip', '127.0.0.1', '--inspector-port', '0', '--persist-to', persist,
      '--show-interactive-dev-session=false', '--log-level', 'info'], true);
    // Wrangler's owned IPC channel reports the actual bound address/port. A
    // coincidental 200 from an unrelated server is never readiness evidence.
    worker.on('message', (message) => { owned ||= ownedRuntimeReady(message, port); });
    worker.stdout.on('data', (chunk) => { startupLog = (startupLog + chunk).slice(-16_000); });
    worker.stderr.on('data', (chunk) => { startupLog = (startupLog + chunk).slice(-16_000); });
    const readyLine = `[wrangler:info] Ready on ${baseURL}`;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      assert.ok(worker.exitCode === null && worker.signalCode === null, `Local Worker exited.\n${logs}`);
      if (!owned || !startupLog.split(/\r?\n/).includes(readyLine)) { await delay(100); continue; }
      try {
        const response = await fetch(`${baseURL}/api/products`, { signal: AbortSignal.timeout(1000) });
        if (response.status === 200 && Array.isArray((await response.json()).items)) return;
      } catch { /* The owned Worker may still be starting. */ }
      await delay(100);
    }
    throw new Error(`Local Worker did not become ready.\n${logs}`);
  }
  async function stop() { const current = worker; worker = undefined; await stopChild(current); }
  async function close() {
    if (closed) return;
    closed = true;
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    await Promise.all([...children].map(stopChild));
    await rm(directory, { recursive: true, force: true });
  }
  const interrupt = () => { void close().finally(() => { process.exitCode = 130; }); };
  const terminate = () => { void close().finally(() => { process.exitCode = 143; }); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try {
    await mkdir(env.HOME);
    await writeFile(configPath, JSON.stringify(config));
    // Apply only the committed schema history, and only to this new local DB.
    const journal = JSON.parse(await readFile(join(siteRoot, 'drizzle/meta/_journal.json'), 'utf8'));
    for (const entry of journal.entries) {
      assert.match(entry.tag, /^\d{4}_[a-z0-9_]+$/);
      await run(['d1', 'execute', 'DB', '--config', configPath, '--local', '--persist-to', persist,
        '--json', '--file', join(siteRoot, 'drizzle', `${entry.tag}.sql`)]);
    }
    await start();
    return { baseURL, directory, execute, start, stop, close, getLogs: () => logs };
  } catch (error) { await close(); throw error; }
}

import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createLocalSiteRuntime } from './site-runtime.mjs';

const runtime = await createLocalSiteRuntime();
let checks = 0;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

function browserSession() {
  let cookie;
  let token;
  async function request(path, { method = 'GET', body, csrf = true, headers = {} } = {}) {
    const sent = new Headers(headers);
    if (cookie) sent.set('Cookie', cookie);
    if (token && csrf) sent.set('X-CSRF-TOKEN', token);
    if (body !== undefined && !(body instanceof Uint8Array)) sent.set('Content-Type', 'application/json');
    const response = await fetch(runtime.baseURL + path, { method, headers: sent,
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000) });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const data = response.headers.get('content-type')?.includes('application/json')
      ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { response, data };
  }
  async function csrf() {
    const result = await request('/api/auth/csrf');
    assert.equal(result.response.status, 200);
    token = result.data.token;
    assert.match(token, /^[a-f0-9]{64}$/);
    return result;
  }
  async function login(username, password) {
    await csrf();
    const result = await request('/api/auth/login', { method: 'POST', body: { username, password } });
    assert.equal(result.response.status, 200);
    await csrf(); // Login rotates CSRF; use the actual refreshed token.
    return result;
  }
  return { request, csrf, login };
}

async function check(label, action) {
  await action();
  checks += 1;
  console.log(`PASS ${label}`);
}

const admin = browserSession();
const customer = browserSession();
try {
  await check('built Worker uses real local D1 seed schema and public catalog', async () => {
    const { response, data } = await customer.request('/api/products');
    assert.equal(response.status, 200);
    assert.ok(data.total >= 24);
    assert.equal(data.items.find((item) => item.id === 'P001').stock, 8);
    const tables = await runtime.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','products','orders','order_items','sessions','operation_guards') ORDER BY name");
    assert.equal(tables.length, 6);
  });
  await check('unauthenticated access, CSRF rejection and session cookie contract', async () => {
    for (const path of ['/api/auth/me', '/api/orders/me', '/api/orders']) {
      const { response, data } = await customer.request(path);
      assert.equal(response.status, 401);
      assert.equal(data.code, 'UNAUTHENTICATED');
    }
    const { response } = await customer.csrf();
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
    const bad = await customer.request('/api/auth/login', { method: 'POST', csrf: false, body: { username: 'admin', password: 'admin123' } });
    assert.equal(bad.response.status, 403);
    assert.equal(bad.data.code, 'CSRF_INVALID');
  });
  await check('registration, login and role authorization run inside workerd', async () => {
    const registered = await customer.request('/api/auth/register', { method: 'POST', body: { username: 'runtime_qa', password: 'RuntimePass123!' } });
    assert.equal(registered.response.status, 201);
    await customer.login('runtime_qa', 'RuntimePass123!');
    await admin.login('admin', 'admin123');
    assert.equal((await customer.request('/api/orders')).response.status, 403);
    assert.equal((await admin.request('/api/orders/me')).response.status, 403);
    const bad = await customer.request('/api/products', { method: 'POST', body: {} });
    assert.equal(bad.response.status, 403);
    const me = await customer.request('/api/auth/me');
    assert.equal(me.data.username, 'runtime_qa');
  });
  let imageUrl;
  await check('R2 upload/fetch preserves exact bytes and rejects invalid files', async () => {
    const rejected = await admin.request('/api/product-images', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.from('not-a-png') });
    assert.equal(rejected.response.status, 400);
    const uploaded = await admin.request('/api/product-images', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
    assert.equal(uploaded.response.status, 201);
    imageUrl = uploaded.data.imageUrl;
    assert.match(imageUrl, /^\/api\/product-images\/[a-f0-9-]+\.png$/);
    const saved = await customer.request(imageUrl);
    assert.equal(saved.response.status, 200);
    assert.equal(saved.response.headers.get('content-type'), 'image/png');
    assert.equal(saved.response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(saved.data, png);
  });
  const names = { name: `${'A'.repeat(49)} literal%_\\ marker`, nameJa: 'あ'.repeat(17), nameZh: '中'.repeat(17) };
  await check('long multilingual and literal wildcard search survives D1 limits', async () => {
    const created = await admin.request('/api/products', { method: 'POST', body: {
      id: 'P900', ...names, category: 'other', imageUrl, priceYen: '1234', stock: 5, weightKg: 0.4,
    } });
    assert.equal(created.response.status, 201);
    for (const keyword of ['a'.repeat(49), names.nameJa, names.nameZh, '%', '_', '\\', '%_\\', ' p900 ']) {
      const { response, data } = await customer.request(`/api/products?q=${encodeURIComponent(keyword)}`);
      assert.equal(response.status, 200);
      assert.ok(data.items.some((item) => item.id === 'P900'));
    }
    const empty = await customer.request(`/api/products?q=${'z'.repeat(120)}`);
    assert.equal(empty.response.status, 200);
    assert.equal(empty.data.total, 0);
  });
  let savedOrder;
  await check('checkout atomic stock deduction, durable idempotent replay and conflict', async () => {
    const options = { method: 'POST', headers: { 'Idempotency-Key': 'runtime-order-key-0001' }, body: { items: [{ productId: 'P900', quantity: 2 }] } };
    const first = await customer.request('/api/orders', options);
    assert.equal(first.response.status, 201);
    savedOrder = first.data;
    const replay = await customer.request('/api/orders', options);
    assert.equal(replay.response.status, 201);
    assert.deepEqual(replay.data, savedOrder);
    assert.equal((await customer.request('/api/products/P900')).data.stock, 3);
    const conflict = await customer.request('/api/orders', { ...options, body: { items: [{ productId: 'P900', quantity: 1 }] } });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.data.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await customer.request('/api/products/P900')).data.stock, 3);
  });
  await check('order snapshots retain multilingual names/image after product edits and deletion', async () => {
    assert.equal(savedOrder.items[0].productNameJa, names.nameJa);
    assert.equal(savedOrder.items[0].productNameZh, names.nameZh);
    assert.equal(savedOrder.items[0].productImageUrl, imageUrl);
    assert.equal((await admin.request('/api/products/P900/names', { method: 'PATCH', body: { name: 'Changed', nameJa: '変更', nameZh: '更改' } })).response.status, 200);
    assert.equal((await admin.request('/api/products/P900', { method: 'DELETE' })).response.status, 204);
    const history = await customer.request('/api/orders/me');
    assert.deepEqual(history.data.items.find((item) => item.orderId === savedOrder.orderId), savedOrder);
    assert.deepEqual((await customer.request(imageUrl)).data, png);
  });
  await check('real D1 supports 24-item exact exhaustion below the bind limit', async () => {
    await runtime.execute("UPDATE products SET stock=1 WHERE id BETWEEN 'P001' AND 'P024'");
    const items = Array.from({ length: 24 }, (_, index) => ({ productId: `P${String(index + 1).padStart(3, '0')}`, quantity: 1 }));
    const result = await customer.request('/api/orders', { method: 'POST', body: { items }, headers: { 'Idempotency-Key': 'runtime-large-key-0001' } });
    assert.equal(result.response.status, 201);
    assert.equal(result.data.items.length, 24);
    const stocks = await runtime.execute("SELECT stock FROM products WHERE id BETWEEN 'P001' AND 'P024'");
    assert.equal(stocks.length, 24);
    assert.ok(stocks.every((item) => item.stock === 0));
    assert.equal((await customer.request('/api/orders', { method: 'POST', body: { items }, headers: { 'Idempotency-Key': 'runtime-large-key-0001' } })).data.orderId, result.data.orderId);
  });
  await check('last-item concurrent orders commit once with no orphan snapshots or negative stock', async () => {
    await runtime.execute("INSERT INTO products(id,name,price_yen,stock,weight_kg) VALUES ('P901','Race A','100',1,1),('P902','Race B','100',1,1)");
    const before = (await runtime.execute('SELECT COUNT(*) AS count FROM orders'))[0].count;
    const [a, b] = await Promise.all([
      customer.request('/api/orders', { method: 'POST', headers: { 'Idempotency-Key': 'runtime-race-key-0001' }, body: { items: [{ productId: 'P901', quantity: 1 }, { productId: 'P902', quantity: 1 }] } }),
      customer.request('/api/orders', { method: 'POST', headers: { 'Idempotency-Key': 'runtime-race-key-0002' }, body: { items: [{ productId: 'P902', quantity: 1 }] } }),
    ]);
    assert.deepEqual([a.response.status, b.response.status].sort(), [201, 409]);
    assert.equal((await runtime.execute('SELECT COUNT(*) AS count FROM orders'))[0].count, before + 1);
    const stocks = await runtime.execute("SELECT id,stock FROM products WHERE id IN ('P901','P902') ORDER BY id");
    assert.equal(stocks[1].stock, 0);
    assert.equal(stocks[0].stock, a.response.status === 201 ? 0 : 1);
    assert.equal((await runtime.execute('SELECT COUNT(*) AS count FROM order_items LEFT JOIN orders USING(order_id) WHERE orders.order_id IS NULL'))[0].count, 0);
  });
  await check('a forced last-item change rolls back the whole real D1 batch', async () => {
    await runtime.execute("INSERT INTO products(id,name,price_yen,stock,weight_kg) VALUES ('P903','Rollback A','100',1,1),('P904','Rollback B','100',1,1)");
    const before = await runtime.execute('SELECT (SELECT COUNT(*) FROM orders) AS orders, (SELECT COUNT(*) FROM order_items) AS items');
    // This trigger exists ONLY in the freshly created local fixture database.
    // It changes stock after calculation but within persistOrder's batch,
    // proving rollback without relying on network-race timing.
    await runtime.execute("CREATE TRIGGER runtime_force_stock_change BEFORE INSERT ON orders WHEN NEW.customer_name='runtime_qa' BEGIN UPDATE products SET stock=0 WHERE id='P904'; END");
    try {
      const result = await customer.request('/api/orders', { method: 'POST', headers: { 'Idempotency-Key': 'runtime-rollback-0001' },
        body: { items: [{ productId: 'P903', quantity: 1 }, { productId: 'P904', quantity: 1 }] } });
      assert.equal(result.response.status, 500);
      assert.equal(result.data.code, 'PERSISTENCE_ERROR');
      assert.deepEqual(await runtime.execute('SELECT (SELECT COUNT(*) FROM orders) AS orders, (SELECT COUNT(*) FROM order_items) AS items'), before);
      assert.deepEqual(await runtime.execute("SELECT stock FROM products WHERE id IN ('P903','P904') ORDER BY id"), [{ stock: 1 }, { stock: 1 }]);
      assert.equal((await runtime.execute("SELECT COUNT(*) AS count FROM operation_guards WHERE id<>'catalog:expanded-products:v1'"))[0].count, 0);
    } finally { await runtime.execute('DROP TRIGGER runtime_force_stock_change'); }
  });
  await check('paged order lists exceed 100 records, remain stable, scoped and bind-safe', async () => {
    await runtime.execute(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<105)
      INSERT INTO orders(order_id,customer_name,total_price_yen,total_weight_kg,estimated_boxes,created_at)
      SELECT printf('ORUNTIME%03d',n),'runtime_qa','100',1,1,'2030-01-01T00:00:00.000Z' FROM seq;
      INSERT INTO order_items(order_id,item_order,product_id,product_name,unit_price_yen,unit_weight_kg,quantity,subtotal_yen,total_weight_kg)
      SELECT order_id,0,'P901','Paging snapshot','100',1,1,'100',1 FROM orders WHERE order_id LIKE 'ORUNTIME%';`);
    const legacy = await customer.request('/api/orders/me');
    const first = await customer.request('/api/orders/me?page=1&size=100&sort=asc');
    const second = await customer.request('/api/orders/me?page=2&size=100&sort=asc');
    assert.equal(first.response.status, 200);
    assert.equal(first.data.total, legacy.data.total);
    assert.ok(first.data.total > 100);
    assert.equal(first.data.items.length, 100);
    assert.deepEqual([...first.data.items, ...second.data.items], legacy.data.items);
    const defaults = await customer.request('/api/orders/me?page=1');
    assert.equal(defaults.data.items.length, 20);
    assert.deepEqual((await customer.request('/api/orders/me?unrelated=ignored')).data, legacy.data);
    assert.deepEqual((await customer.request('/api/orders/me?page=0001&size=020&sort=asc')).data, defaults.data);
    const reverse = await customer.request('/api/orders/me?page=1&size=100&sort=desc');
    assert.deepEqual(reverse.data.items.map((item) => item.orderId), legacy.data.items.toReversed().slice(0, 100).map((item) => item.orderId));
    assert.equal((await customer.request('/api/orders/me?page=1000000&size=100')).data.items.length, 0);
    const filtered = await admin.request('/api/orders?customer=RUNTIME_QA&page=1&size=100');
    assert.equal(filtered.data.total, legacy.data.total);
    assert.ok(filtered.data.items.every((item) => item.customerName === 'runtime_qa'));
    for (const keyword of ['z'.repeat(49), 'あ'.repeat(17), '%', '\\']) {
      const empty = await admin.request(`/api/orders?customer=${encodeURIComponent(keyword)}&page=1`);
      assert.equal(empty.response.status, 200);
      assert.equal(empty.data.total, 0);
    }
    for (const query of ['page=0', 'size=101', 'sort=invalid', 'page=1&page=2', 'size=1.5', 'page=1000001']) {
      assert.equal((await customer.request(`/api/orders/me?${query}`)).response.status, 400);
    }
  });
  await check('session housekeeping is bounded, preserves active sessions and does not run each request', async () => {
    await runtime.stop();
    await runtime.execute(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<105)
      INSERT INTO sessions(session_id,username,csrf_token,expires_at) SELECT printf('expired-runtime-%03d',n),NULL,'expired-fixture',0 FROM seq;
      INSERT INTO sessions(session_id,username,csrf_token,expires_at) VALUES ('active-runtime','runtime_qa','active-fixture',${Math.floor(Date.now() / 1000) + 3600});`);
    await runtime.start(); // Readiness makes one DB-backed public request.
    let rows = await runtime.execute("SELECT SUM(session_id LIKE 'expired-runtime-%') AS expired, SUM(session_id='active-runtime') AS active FROM sessions");
    assert.equal(rows[0].expired, 5);
    assert.equal(rows[0].active, 1);
    await customer.request('/api/products');
    rows = await runtime.execute("SELECT COUNT(*) AS count FROM sessions WHERE session_id LIKE 'expired-runtime-%'");
    assert.equal(rows[0].count, 5);
    assert.equal((await customer.request('/api/auth/me')).response.status, 200);
  });
  await check('logout invalidates the actual D1 session', async () => {
    assert.equal((await customer.request('/api/auth/logout', { method: 'POST' })).response.status, 204);
    assert.equal((await customer.request('/api/auth/me')).response.status, 401);
  });
  console.log(`Site runtime integration: ${checks} checks passed against built workerd/D1/R2.`);
} catch (error) {
  console.error(runtime.getLogs());
  throw error;
} finally {
  await runtime.close();
  await assert.rejects(access(runtime.directory), { code: 'ENOENT' });
}

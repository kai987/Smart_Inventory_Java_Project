import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keyedOrderId } from './order-idempotency';

const context = vi.hoisted(() => ({ database: null as D1Database | null, bucket: null as R2Bucket | null }));
vi.mock('./database', () => ({ ensureDatabase: async () => context.database! }));
vi.mock('cloudflare:workers', () => ({ env: { get BUCKET() { return context.bucket!; } } }));
import { handleApiRequest } from './api-handler';

let sqlite: DatabaseSync;
let images: Map<string, { bytes: Uint8Array; contentType: string }>;
let maximumBoundParameters = 0;
let readQueries: string[] = [];
let beforeBatch: (() => void) | null = null;
class Prepared {
  constructor(readonly sql: string, readonly values: (string | number | null)[] = []) { }
  bind(...values: (string | number | null)[]) {
    maximumBoundParameters = Math.max(maximumBoundParameters, values.length);
    if (values.length > 100) throw new Error('D1 queries support at most 100 bound parameters.');
    // Host SQLite defaults to a much larger LIKE limit than deployed D1.
    if (/\bLIKE\s+\?/i.test(this.sql) && values.some((value) =>
      typeof value === 'string' && new TextEncoder().encode(value).length > 50)) {
      throw new Error('D1 LIKE patterns support at most 50 UTF-8 bytes.');
    }
    return new Prepared(this.sql, values);
  }
  async first<T>() { readQueries.push(this.sql); return (sqlite.prepare(this.sql).get(...this.values) as T | undefined) ?? null; }
  async all<T>() { readQueries.push(this.sql); return { results: sqlite.prepare(this.sql).all(...this.values) as T[], success: true }; }
  async run() {
    const result = sqlite.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

beforeEach(() => {
  maximumBoundParameters = 0;
  readQueries = [];
  beforeBatch = null;
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users(username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE products(id TEXT PRIMARY KEY, name TEXT, price_yen TEXT, stock INTEGER CHECK(stock>=0), weight_kg REAL);
    CREATE TABLE orders(order_id TEXT PRIMARY KEY, customer_name TEXT REFERENCES users(username),
      total_price_yen TEXT, total_weight_kg REAL, estimated_boxes INTEGER, created_at TEXT);
    CREATE TABLE order_items(id INTEGER PRIMARY KEY, order_id TEXT REFERENCES orders(order_id), item_order INTEGER,
      product_id TEXT, product_name TEXT, unit_price_yen TEXT, unit_weight_kg REAL, quantity INTEGER,
      subtotal_yen TEXT, total_weight_kg REAL);
    CREATE TABLE sessions(session_id TEXT PRIMARY KEY, username TEXT REFERENCES users(username), csrf_token TEXT, expires_at INTEGER);
    CREATE TABLE operation_guards(id TEXT PRIMARY KEY, ok INTEGER CHECK(ok=1));
    INSERT INTO users VALUES ('customer','unused','CUSTOMER'),('other','unused','CUSTOMER');
    INSERT INTO products VALUES ('P001','Laptop','120000',8,3),('P002','Mouse','2500',30,0.2);
    ALTER TABLE products ADD COLUMN name_ja TEXT;
    ALTER TABLE products ADD COLUMN name_zh TEXT;
    ALTER TABLE products ADD COLUMN category TEXT;
    ALTER TABLE products ADD COLUMN image_url TEXT;
    ALTER TABLE order_items ADD COLUMN product_name_ja TEXT;
    ALTER TABLE order_items ADD COLUMN product_name_zh TEXT;
    ALTER TABLE order_items ADD COLUMN product_image_url TEXT;
    INSERT INTO users VALUES ('admin','unused','ADMIN');
  `);
  for (const [id, user] of [['customer-session', 'customer'], ['other-session', 'other'], ['anonymous-session', null], ['admin-session', 'admin']]) {
    sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(id, user, 'test-token', Math.floor(Date.now() / 1000) + 1800);
  }
  context.database = {
    prepare: (sql: string) => new Prepared(sql),
    batch: async (statements: Prepared[]) => {
      // Exercise a lookup/commit race, then run the same all-or-nothing SQL batch as D1.
      await Promise.resolve();
      const race = beforeBatch;
      beforeBatch = null;
      race?.();
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) {
          const result = sqlite.prepare(statement.sql).run(...statement.values);
          results.push({ success: true, meta: { changes: Number(result.changes) } });
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
  images = new Map();
  context.bucket = {
    head: async (key: string) => images.has(key) ? { key } : null,
    put: async (key: string, bytes: Uint8Array, options: { httpMetadata: { contentType: string } }) => {
      images.set(key, { bytes: Uint8Array.from(bytes), contentType: options.httpMetadata.contentType });
      return { key };
    },
    get: async (key: string) => {
      const image = images.get(key);
      return image ? { body: new Blob([image.bytes as Uint8Array<ArrayBuffer>]).stream(), size: image.bytes.length, httpEtag: '"image-etag"' } : null;
    },
  } as unknown as R2Bucket;
});
afterEach(() => sqlite.close());

function post(path: string, body: unknown, key: string | null = 'checkout_1234567890', session = 'customer-session', method = 'POST') {
  return handleApiRequest(new Request(`http://localhost/api/${path}`, {
    method, headers: {
      'Content-Type': 'application/json', 'X-CSRF-TOKEN': 'test-token',
      Cookie: `SMART_INVENTORY_SESSION=${session}`,
      ...(key === null ? {} : { 'Idempotency-Key': key }),
    }, body: JSON.stringify(body),
  }));
}
const intent = { items: [{ productId: 'P002', quantity: 2 }] };
type OrderResponse = { orderId: string };
type ErrorResponse = { code: string };
const orderJson = async (response: Response) => await response.json() as OrderResponse;
const stock = () => sqlite.prepare("SELECT stock FROM products WHERE id='P002'").get()!.stock;
const count = () => sqlite.prepare('SELECT COUNT(*) AS count FROM orders').get()!.count;

describe('Site literal substring search', () => {
  const get = (path: string, session?: string) => handleApiRequest(new Request(`http://localhost/api/${path}`, {
    ...(session ? { headers: { Cookie: `SMART_INVENTORY_SESSION=${session}` } } : {}),
  }));

  it.each([
    ['ASCII at the former boundary', 'A'.repeat(48), 'name'],
    ['ASCII beyond the former boundary', 'A'.repeat(49), 'name'],
    ['a long valid product name', 'A'.repeat(90), 'name'],
    ['Japanese at the former boundary', 'あ'.repeat(16), 'nameJa'],
    ['Japanese beyond the former boundary', 'あ'.repeat(17), 'nameJa'],
    ['Chinese beyond the former boundary', '旅'.repeat(17), 'nameZh'],
    ['four-byte Unicode', '🧳'.repeat(17), 'nameJa'],
    ['many literal percent signs', '%'.repeat(25), 'name'],
    ['many literal underscores', '_'.repeat(25), 'name'],
    ['many literal backslashes', '\\'.repeat(25), 'name'],
  ])('matches %s without truncating the keyword', async (_label, keyword, field) => {
    const product = { id: 'P900', name: 'Search fixture', priceYen: '42', stock: 2, weightKg: 0.5, [field]: keyword };
    expect((await post('products', product, null, 'admin-session')).status).toBe(201);
    const response = await get(`products?q=${encodeURIComponent(` ${keyword.toLowerCase()} `)}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [{ ...product, available: true }], total: 1 });
  });

  it.each(['%', '_', '\\', '%_\\'])('matches %s literally instead of treating it as a wildcard', async (keyword) => {
    const product = { id: 'P900', name: `Literal ${keyword} marker`, priceYen: '42', stock: 2, weightKg: 0.5 };
    expect((await post('products', product, null, 'admin-session')).status).toBe(201);
    const response = await get(`products?q=${encodeURIComponent(keyword)}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [{ ...product, available: true }], total: 1 });
  });

  it('retains ID/name case matching, nullable names, empty search, and stock filtering', async () => {
    const id = await get('products?q=%20p001%20');
    expect((await id.json() as { items: { id: string }[] }).items.map((item) => item.id)).toEqual(['P001']);
    const name = await get('products?q=lApToP');
    expect((await name.json() as { total: number }).total).toBe(1);
    sqlite.prepare("UPDATE products SET stock=0 WHERE id='P001'").run();
    expect(await (await get('products?q=LAPTOP&inStockOnly=true')).json()).toEqual({ items: [], total: 0 });
    expect((await (await get('products?q=%20%20')).json() as { total: number }).total).toBe(2);
    const missing = await get(`products?q=${encodeURIComponent('不存在'.repeat(100))}`);
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ items: [], total: 0 });
  });

  it('handles long administrator customer filters and literal underscores without changing saved orders', async () => {
    sqlite.prepare("INSERT INTO users VALUES ('cust_mer','unused','CUSTOMER'),('custXmer','unused','CUSTOMER')").run();
    expect((await post('orders', intent)).status).toBe(201);
    for (const [id, customer] of [['literal-order', 'cust_mer'], ['decoy-order', 'custXmer']]) {
      sqlite.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?)').run(id, customer, '0', 0, 1, '2026-01-01T00:00:00Z');
    }
    const saved = sqlite.prepare('SELECT * FROM orders ORDER BY order_id').all();
    const short = await get('orders?customer=CUST', 'admin-session');
    expect(short.status).toBe(200);
    expect((await short.json() as { total: number }).total).toBe(3);
    const literal = await get('orders?customer=cust_mer', 'admin-session');
    expect((await literal.json() as { items: { orderId: string }[] }).items.map((order) => order.orderId)).toEqual(['literal-order']);
    for (const keyword of ['x'.repeat(49), 'あ'.repeat(17), '%', '\\']) {
      const response = await get(`orders?customer=${encodeURIComponent(keyword)}`, 'admin-session');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ items: [], total: 0 });
    }
    expect(sqlite.prepare('SELECT * FROM orders ORDER BY order_id').all()).toEqual(saved);
  });
});

describe('Site order paging and bulk detail reads', () => {
  const get = (query = '', session = 'customer-session', path = 'orders/me') => handleApiRequest(new Request(
    `http://localhost/api/${path}${query ? `?${query}` : ''}`,
    { headers: { Cookie: `SMART_INVENTORY_SESSION=${session}` } },
  ));
  type ListedOrder = { orderId: string; customerName: string; totalPriceYen: string; items: { productId: string; productNameJa?: string; productNameZh?: string; productImageUrl?: string; unitPriceYen: string }[] };
  type ListedOrders = { items: ListedOrder[]; total: number };
  beforeEach(() => {
    for (let i = 0; i < 130; i++) {
      const id = `PAGE${String(i).padStart(3, '0')}`;
      sqlite.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?)').run(id, i < 125 ? 'customer' : 'other', '12000000000000000001', 1, 1, '2026-01-01T00:00:00Z');
      for (const itemOrder of [1, 0]) sqlite.prepare(`INSERT INTO order_items(
        order_id,item_order,product_id,product_name,unit_price_yen,unit_weight_kg,quantity,subtotal_yen,total_weight_kg,
        product_name_ja,product_name_zh,product_image_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, itemOrder, `P00${itemOrder + 1}`, 'Saved name', '12000000000000000001', 0.5, 1, '12000000000000000001', 0.5,
        '保存した名前', '保存名称', '/api/product-images/saved.png',
      );
    }
  });
  const body = async (response: Response) => { expect(response.status).toBe(200); return await response.json() as ListedOrders; };

  it('keeps legacy full ascending histories with exactly one bulk item read beyond 100 orders', async () => {
    const listed = await body(await get('unknown=ignored'));
    expect(listed.total).toBe(125);
    expect(listed.items).toHaveLength(125);
    expect(listed.items[0].orderId).toBe('PAGE000');
    expect(listed.items.at(-1)?.orderId).toBe('PAGE124');
    expect(readQueries.filter((sql) => /FROM order_items\b/.test(sql))).toHaveLength(1);
    expect(maximumBoundParameters).toBeLessThanOrEqual(3);
    for (const order of listed.items) {
      expect(order.customerName).toBe('customer');
      expect(order.totalPriceYen).toBe('12000000000000000001');
      expect(order.items.map((item) => item.productId)).toEqual(['P001', 'P002']);
      expect(order.items[0]).toMatchObject({ productNameJa: '保存した名前', productNameZh: '保存名称',
        productImageUrl: '/api/product-images/saved.png', unitPriceYen: '12000000000000000001' });
    }
  });
  it('paginates with stable timestamp ties, defaults and accurate matched totals', async () => {
    const first = await body(await get('page=1'));
    const second = await body(await get('page=0002'));
    expect(first.items.map((order) => order.orderId)).toEqual(Array.from({ length: 20 }, (_, i) => `PAGE${String(i).padStart(3, '0')}`));
    expect(second.items.map((order) => order.orderId)).toEqual(Array.from({ length: 20 }, (_, i) => `PAGE${String(i + 20).padStart(3, '0')}`));
    expect(second.total).toBe(125);
    const last = await body(await get('page=7&size=20'));
    expect(last.items).toHaveLength(5);
    expect(last.total).toBe(125);
    expect(await body(await get('page=1000000&size=100'))).toEqual({ items: [], total: 125 });
    const latest = await body(await get('sort=desc&size=5'));
    expect(latest.items.map((order) => order.orderId)).toEqual(['PAGE124', 'PAGE123', 'PAGE122', 'PAGE121', 'PAGE120']);
  });
  it('bulk-fetches only the selected page, preserving historical snapshots after current products change', async () => {
    sqlite.prepare("UPDATE products SET name='New catalog name',name_ja=NULL,name_zh=NULL,image_url=NULL").run();
    const listed = await body(await get('page=2&size=100'));
    expect(listed.items).toHaveLength(25);
    const itemReads = readQueries.filter((sql) => /FROM order_items\b/.test(sql));
    expect(itemReads).toHaveLength(1);
    expect(itemReads[0]).toContain('json_each(?)');
    expect(listed.items[0].items[0].productNameJa).toBe('保存した名前');
  });
  it('keeps admin filtering, customer isolation and roles with paging', async () => {
    const all = await body(await get('page=2&size=100', 'admin-session', 'orders'));
    expect(all.total).toBe(130);
    expect(all.items).toHaveLength(30);
    const filtered = await body(await get('customer=%20OtHeR%20&page=2&size=3', 'admin-session', 'orders'));
    expect(filtered.total).toBe(5);
    expect(filtered.items.map((order) => order.orderId)).toEqual(['PAGE128', 'PAGE129']);
    expect(await body(await get('customer=missing&page=1', 'admin-session', 'orders'))).toEqual({ items: [], total: 0 });
    expect((await get('page=1', 'customer-session', 'orders')).status).toBe(403);
    expect((await get('page=1', 'admin-session')).status).toBe(403);
    expect((await get('page=1', 'anonymous-session')).status).toBe(401);
  });
  it.each(['page=0', 'size=101', 'sort=DESC', 'page=1&page=2', 'size=', 'sort=asc&sort=desc'])('returns structured validation for %s', async (query) => {
    const response = await get(query);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_ERROR', fieldErrors: expect.any(Array) });
  });
});

describe('Site request maintenance wiring', () => {
  it('cleans at most 100 expired sessions on API access without changing active sessions or durable data', async () => {
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 105; i++) sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(`expired-${i}`, null, 'old-token', now - 1);
    const active = sqlite.prepare('SELECT * FROM sessions WHERE expires_at > ? ORDER BY session_id').all(now);
    const products = sqlite.prepare('SELECT * FROM products ORDER BY id').all();
    const first = await handleApiRequest(new Request('http://localhost/api/products'));
    expect(first.status).toBe(200);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM sessions WHERE expires_at <= ?').get(now)!.count).toBe(5);
    await handleApiRequest(new Request('http://localhost/api/products'));
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM sessions WHERE expires_at <= ?').get(now)!.count).toBe(5);
    expect(sqlite.prepare('SELECT * FROM sessions WHERE expires_at > ? ORDER BY session_id').all(now)).toEqual(active);
    expect(sqlite.prepare('SELECT * FROM products ORDER BY id').all()).toEqual(products);
  });
  it('continues serving the API when maintenance fails and omits database errors from its warning', async () => {
    const original = context.database!.prepare;
    vi.spyOn(context.database!, 'prepare').mockImplementation((sql: string) => {
      if (/DELETE FROM sessions/.test(sql)) throw new Error('sensitive session details');
      return original(sql);
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect((await handleApiRequest(new Request('http://localhost/api/products'))).status).toBe(200);
      expect(warning).toHaveBeenCalledExactlyOnceWith('Expired session maintenance failed; it will retry later.');
    } finally { vi.restoreAllMocks(); }
  });
});

const pngImage = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j91sAAAAASUVORK5CYII=', 'base64'));
// Complete one-pixel grayscale JPEG: quantization/frame/Huffman/scan/EOI.
const jpegImage = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xdb, 0, 67, 0, ...Array<number>(64).fill(1),
  0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0,
  0xff, 0xc4, 0, 20, 0, 1, ...Array<number>(15).fill(0), 0,
  0xff, 0xc4, 0, 20, 0x10, 1, ...Array<number>(15).fill(0), 0,
  0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x3f, 0xff, 0xd9,
]);
const webpImage = new Uint8Array(readFileSync(new URL('../public/product-images/laptop.webp', import.meta.url)));

async function upload(bytes: Uint8Array, contentType = 'image/png', session = 'admin-session', csrf: string | null = 'test-token') {
  return handleApiRequest(new Request('http://localhost/api/product-images', {
    method: 'POST', headers: {
      'Content-Type': contentType,
      Cookie: `SMART_INVENTORY_SESSION=${session}`,
      ...(csrf === null ? {} : { 'X-CSRF-TOKEN': csrf }),
    }, body: bytes as Uint8Array<ArrayBuffer>,
  }));
}

describe('Site product image storage', () => {
  it.each([['image/png', pngImage, 'png'], ['image/jpeg', jpegImage, 'jpg'], ['image/webp', webpImage, 'webp']] as const)('uploads complete %s binary and serves immutable public bytes', async (contentType, bytes, extension) => {
    const response = await upload(bytes, contentType);
    expect(response.status).toBe(201);
    const { imageUrl } = await response.json() as { imageUrl: string };
    expect(imageUrl).toMatch(new RegExp(`^/api/product-images/[0-9a-f-]{36}\\.${extension}$`));
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    const image = await handleApiRequest(new Request(`http://localhost${imageUrl}`));
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe(contentType);
    expect(image.headers.get('content-length')).toBe(String(bytes.length));
    expect(image.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(image.headers.get('x-content-type-options')).toBe('nosniff');
    expect(image.headers.get('content-security-policy')).toContain('sandbox');
    expect(image.headers.get('etag')).toBe('"image-etag"');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(bytes);
  });

  it('requires administrator authentication and CSRF before reading or saving uploaded bytes', async () => {
    expect((await upload(pngImage, 'image/png', 'customer-session')).status).toBe(403);
    expect((await upload(pngImage, 'image/png', 'anonymous-session')).status).toBe(401);
    expect((await upload(pngImage, 'image/png', 'admin-session', null)).status).toBe(403);
    expect((await upload(pngImage, 'image/png', 'admin-session', 'wrong-token')).status).toBe(403);
    expect(images.size).toBe(0);
  });

  it('rejects missing/empty images, MIME mismatches and truncated or fake image bytes', async () => {
    expect((await upload(new Uint8Array())).status).toBe(400);
    expect(await (await upload(new Uint8Array())).json()).toMatchObject({ code: 'IMAGE_EMPTY' });
    for (const mime of ['image/svg+xml', 'text/html', 'application/octet-stream', 'image/gif', 'toString']) {
      const response = await upload(pngImage, mime);
      expect(response.status).toBe(415);
      expect(await response.json()).toMatchObject({ code: 'IMAGE_TYPE' });
    }
    for (const [bytes, mime] of [[pngImage, 'image/jpeg'], [jpegImage, 'image/png'], [pngImage.slice(0, -1), 'image/png'],
      [jpegImage.slice(0, -2), 'image/jpeg'], [webpImage.slice(0, -2), 'image/webp'], [new Uint8Array(100), 'image/png']] as const) {
      const response = await upload(bytes, mime);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'IMAGE_TYPE' });
    }
    expect(images.size).toBe(0);
  });

  it('rejects JPEG scans with premature EOI markers or trailing bytes rather than accepting only their headers', async () => {
    const noEntropy = Uint8Array.from([...jpegImage.slice(0, -3), 0xff, 0xd9, 0, 0xff, 0xd9]);
    const trailingData = Uint8Array.from([...jpegImage, 0, 0xff, 0xd9]);
    for (const invalid of [noEntropy, trailingData]) {
      const response = await upload(invalid, 'image/jpeg');
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'IMAGE_TYPE' });
    }
    expect(images.size).toBe(0);
  });

  it('enforces the streaming 2 MiB bound without Content-Length and stops reading excess bytes', async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); },
      cancel() { canceled = true; },
    });
    const response = await handleApiRequest(new Request('http://localhost/api/product-images', {
      method: 'POST', headers: { 'Content-Type': 'image/png', 'X-CSRF-TOKEN': 'test-token', Cookie: 'SMART_INVENTORY_SESSION=admin-session' },
      body: stream, duplex: 'half',
    } as RequestInit));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'IMAGE_SIZE' });
    expect(canceled).toBe(true);
    expect(images.size).toBe(0);
  });

  it('rejects declared oversize bodies before reading and accepts exactly 2 MiB only if structurally valid', async () => {
    const response = await handleApiRequest(new Request('http://localhost/api/product-images', {
      method: 'POST', headers: { 'Content-Type': 'image/png', 'Content-Length': String(2 * 1024 * 1024 + 1), 'X-CSRF-TOKEN': 'test-token', Cookie: 'SMART_INVENTORY_SESSION=admin-session' }, body: pngImage,
    }));
    expect(response.status).toBe(413);
    expect((await upload(new Uint8Array(2 * 1024 * 1024))).status).toBe(400);
    expect(images.size).toBe(0);
  });

  it('rejects traversal, non-UUID filenames and missing media without exposing bucket paths', async () => {
    for (const path of ['not-a-uuid.png', '..%2Fprivate.png', '%2e%2e%2fusers.csv', '00000000-0000-4000-8000-000000000000.svg', '00000000-0000-4000-8000-000000000000.png']) {
      const response = await handleApiRequest(new Request(`http://localhost/api/product-images/${path}`));
      expect(response.status).toBe(404);
    }
    expect((await handleApiRequest(new Request('http://localhost/api/product-images/00000000-0000-4000-8000-000000000000.png', { method: 'DELETE' }))).status).toBe(404);
  });
});

describe('Site administrator multilingual product names', () => {
  const product = { id: 'P900', name: 'Travel Mug', priceYen: '1900', stock: 12, weightKg: 0.4 };
  const get = (path: string, session?: string) => handleApiRequest(new Request(`http://localhost/api/${path}`, {
    ...(session ? { headers: { Cookie: `SMART_INVENTORY_SESSION=${session}` } } : {}),
  }));

  it('keeps legacy product responses unchanged when optional names are omitted or blank', async () => {
    const created = await post('products', { ...product, nameJa: ' ', nameZh: null }, null, 'admin-session');
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ ...product, available: true });
    expect(await (await get('products/P900')).json()).toEqual({ ...product, available: true });
    expect(sqlite.prepare("SELECT name_ja, name_zh FROM products WHERE id='P900'").get())
      .toEqual({ name_ja: null, name_zh: null });
  });

  it('persists and returns trimmed translations on create, detail and filtered lists', async () => {
    const names = { nameJa: 'トラベルマグ', nameZh: '旅行杯' };
    const created = await post('products', { ...product, name: ' Travel Mug ', nameJa: ' トラベルマグ ', nameZh: ' 旅行杯 ' }, null, 'admin-session');
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ ...product, ...names, available: true });
    expect(await (await get('products/P900')).json()).toEqual({ ...product, ...names, available: true });
    for (const query of ['P900', 'TRAVEL', 'マグ', '旅行']) {
      expect(await (await get(`products?q=${encodeURIComponent(query)}`)).json())
        .toEqual({ items: [{ ...product, ...names, available: true }], total: 1 });
    }
    expect(await (await get('products?q=%25')).json()).toEqual({ items: [], total: 0 });
  });

  it('edits and clears names without changing stock, price, weight, or identity', async () => {
    await post('products', { ...product, nameJa: 'トラベルマグ', nameZh: '旅行杯' }, null, 'admin-session');
    const changed = await post('products/P900/names', { name: ' Insulated Mug ', nameJa: ' 保温マグ ', nameZh: ' 保温杯 ' }, null, 'admin-session', 'PATCH');
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({ ...product, name: 'Insulated Mug', nameJa: '保温マグ', nameZh: '保温杯', available: true });
    const cleared = await post('products/P900/names', { name: 'Insulated Mug', nameJa: ' ' }, null, 'admin-session', 'PATCH');
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ ...product, name: 'Insulated Mug', available: true });
    const absent = await post('products/P999/names', { name: 'Missing' }, null, 'admin-session', 'PATCH');
    expect(absent.status).toBe(404);
  });

  it('requires administrator identity and a matching CSRF token for name updates', async () => {
    const body = { name: 'Changed Laptop', nameJa: '変更済み', nameZh: '已修改' };
    expect((await post('products/P001/names', body, null, 'customer-session', 'PATCH')).status).toBe(403);
    expect((await post('products/P001/names', body, null, 'anonymous-session', 'PATCH')).status).toBe(401);
    expect((await handleApiRequest(new Request('http://localhost/api/products/P001/names', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: 'SMART_INVENTORY_SESSION=admin-session' },
      body: JSON.stringify(body),
    }))).status).toBe(403);
    expect(sqlite.prepare("SELECT name FROM products WHERE id='P001'").get()!.name).toBe('Laptop');
  });

  it.each([42, {}, 'x'.repeat(101), 'bad,name', 'bad|name', 'bad:name', 'bad\nname'])('rejects invalid optional translations: %j', async (invalid) => {
    const created = await post('products', { ...product, nameJa: invalid }, null, 'admin-session');
    expect(created.status).toBe(400);
    expect(await created.json()).toMatchObject({ code: 'VALIDATION_ERROR', fieldErrors: [{ field: 'nameJa' }] });
    const changed = await post('products/P001/names', { name: 'Laptop', nameZh: invalid }, null, 'admin-session', 'PATCH');
    expect(changed.status).toBe(400);
    expect(await changed.json()).toMatchObject({ code: 'VALIDATION_ERROR', fieldErrors: [{ field: 'nameZh' }] });
    expect(sqlite.prepare("SELECT id FROM products WHERE id='P900'").get()).toBeUndefined();
  });

  it('snapshots translations into customer and admin orders and durable retries after rename or deletion', async () => {
    await post('products', { ...product, nameJa: 'トラベルマグ', nameZh: '旅行杯' }, null, 'admin-session');
    const request = { items: [{ productId: 'P900', quantity: 2 }] };
    const created = await post('orders', request);
    expect(created.status).toBe(201);
    const original = await created.json();
    expect(original).toMatchObject({ items: [{ productId: 'P900', productName: 'Travel Mug', productNameJa: 'トラベルマグ', productNameZh: '旅行杯', quantity: 2 }] });
    await post('products/P900/names', { name: 'Renamed Mug', nameJa: '新しい名前', nameZh: '新名称' }, null, 'admin-session', 'PATCH');
    expect(await (await post('orders', request)).json()).toEqual(original);
    sqlite.exec("DELETE FROM products WHERE id='P900'");
    expect(await (await get('orders/me', 'customer-session')).json()).toEqual({ items: [original], total: 1 });
    expect(await (await get('orders', 'admin-session')).json()).toEqual({ items: [original], total: 1 });
    expect(await (await post('orders', request)).json()).toEqual(original);
    expect(sqlite.prepare('SELECT product_name_ja, product_name_zh FROM order_items').get())
      .toEqual({ product_name_ja: 'トラベルマグ', product_name_zh: '旅行杯' });
  });
});

describe('Site administrator custom product details', () => {
  const product = { id: 'P900', name: 'Ceramic Mug', nameJa: '陶器マグ', nameZh: '陶瓷杯', category: 'kitchen', priceYen: '1900', stock: 12, weightKg: 0.4 };
  const get = (path: string, session?: string) => handleApiRequest(new Request(`http://localhost/api/${path}`, {
    ...(session ? { headers: { Cookie: `SMART_INVENTORY_SESSION=${session}` } } : {}),
  }));
  const imageUrl = async () => (await (await upload(pngImage)).json() as { imageUrl: string }).imageUrl;

  it('creates category/image metadata while preserving old clients and no-image products', async () => {
    const response = await post('products', product, null, 'admin-session');
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ...product, available: true });
    const legacy = await get('products/P001');
    expect(await legacy.json()).toEqual({ id: 'P001', name: 'Laptop', priceYen: '120000', stock: 8, weightKg: 3, available: true });
    const url = await imageUrl();
    const withImage = { ...product, id: 'P901', category: 'home', imageUrl: url };
    expect(await (await post('products', withImage, null, 'admin-session')).json()).toEqual({ ...withImage, available: true });
    expect(await (await get('products/P901')).json()).toEqual({ ...withImage, available: true });
    expect(await (await get('products?q=P901')).json()).toEqual({ items: [{ ...withImage, available: true }], total: 1 });
  });

  it('atomically edits names/category and retains, replaces, then clears the image without changing inventory', async () => {
    const first = await imageUrl();
    const second = await imageUrl();
    await post('products', { ...product, imageUrl: first }, null, 'admin-session');
    const details = { name: 'Travel Mug', nameJa: 'トラベルマグ', nameZh: '旅行杯', category: 'travel' };
    const retained = await post('products/P900/details', details, null, 'admin-session', 'PATCH');
    expect(retained.status).toBe(200);
    expect(await retained.json()).toEqual({ ...product, ...details, imageUrl: first, available: true });
    const replaced = await post('products/P900/details', { ...details, imageUrl: second }, null, 'admin-session', 'PATCH');
    expect(await replaced.json()).toEqual({ ...product, ...details, imageUrl: second, available: true });
    const namesOnly = await post('products/P900/names', { name: 'Only Rename', nameJa: '名前のみ', nameZh: '仅改名称' }, null, 'admin-session', 'PATCH');
    expect(await namesOnly.json()).toEqual({ ...product, ...details, name: 'Only Rename', nameJa: '名前のみ', nameZh: '仅改名称', imageUrl: second, available: true });
    const cleared = await post('products/P900/details', { ...details, imageUrl: null }, null, 'admin-session', 'PATCH');
    expect(await cleared.json()).toEqual({ ...product, ...details, available: true });
    expect(images.size).toBe(2); // immutable old images remain available to snapshots
  });

  it('rejects invalid or missing categories/image URLs and does not partially rename the product', async () => {
    await post('products', product, null, 'admin-session');
    for (const invalid of [null, '', 'food', 42, {}]) {
      const created = await post('products', { ...product, id: 'P901', category: invalid }, null, 'admin-session');
      expect(created.status).toBe(400);
      expect(await created.json()).toMatchObject({ fieldErrors: [{ field: 'category' }] });
      const changed = await post('products/P900/details', { name: 'Unwanted Rename', category: invalid }, null, 'admin-session', 'PATCH');
      expect(changed.status).toBe(400);
    }
    expect((await post('products/P900/details', { name: 'Unwanted Rename' }, null, 'admin-session', 'PATCH')).status).toBe(400);
    for (const invalid of ['', false, 42, {}, 'https://example.com/a.png', 'data:image/png;base64,AAAA', 'blob:example', '/api/product-images/../users.csv', '/product-images/laptop.webp', '/api/product-images/00000000-0000-4000-8000-000000000000.png']) {
      const changed = await post('products/P900/details', { name: 'Unwanted Rename', category: 'home', imageUrl: invalid }, null, 'admin-session', 'PATCH');
      expect(changed.status).toBe(400);
      expect(await changed.json()).toMatchObject({ fieldErrors: [{ field: 'imageUrl' }] });
      expect((await post('products', { ...product, id: 'P901', imageUrl: invalid }, null, 'admin-session')).status).toBe(400);
    }
    expect(await (await get('products/P900')).json()).toEqual({ ...product, available: true });
    expect((await get('products/P901')).status).toBe(404);
  });

  it('requires administrator and CSRF and leaves product data untouched on unauthorized details updates', async () => {
    const details = { name: 'Unwanted Rename', category: 'other' };
    expect((await post('products/P001/details', details, null, 'customer-session', 'PATCH')).status).toBe(403);
    expect((await post('products/P001/details', details, null, 'anonymous-session', 'PATCH')).status).toBe(401);
    expect((await handleApiRequest(new Request('http://localhost/api/products/P001/details', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: 'SMART_INVENTORY_SESSION=admin-session' }, body: JSON.stringify(details),
    }))).status).toBe(403);
    expect(sqlite.prepare("SELECT name,category,image_url FROM products WHERE id='P001'").get()).toEqual({ name: 'Laptop', category: null, image_url: null });
  });

  it('stores immutable image snapshots and replays the same order after image replacement and product deletion', async () => {
    const first = await imageUrl();
    const second = await imageUrl();
    await post('products', { ...product, imageUrl: first }, null, 'admin-session');
    const intent = { items: [{ productId: 'P900', quantity: 1 }] };
    const response = await post('orders', intent);
    expect(response.status).toBe(201);
    const original = await response.json();
    expect(original).toMatchObject({ items: [{ productId: 'P900', productImageUrl: first, productName: 'Ceramic Mug', productNameJa: '陶器マグ', productNameZh: '陶瓷杯' }] });
    await post('products/P900/details', { name: 'New Mug', category: 'other', imageUrl: second }, null, 'admin-session', 'PATCH');
    expect(await (await post('orders', intent)).json()).toEqual(original);
    await post('products/P900', null, null, 'admin-session', 'DELETE');
    expect(await (await post('orders', intent)).json()).toEqual(original);
    expect(await (await get('orders/me', 'customer-session')).json()).toEqual({ items: [original], total: 1 });
    expect(await (await get('orders', 'admin-session')).json()).toEqual({ items: [original], total: 1 });
    expect((await handleApiRequest(new Request(`http://localhost${first}`))).status).toBe(200);
    expect(images.size).toBe(2);
  });
});

describe('Site large orders under D1 parameter limits', () => {
  const imageUrl = '/api/product-images/00000000-0000-4000-8000-000000000000.webp';
  function seedCatalog(size: number) {
    sqlite.exec('DELETE FROM products');
    const insert = sqlite.prepare(`INSERT INTO products(
      id,name,name_ja,name_zh,price_yen,stock,weight_kg,image_url
    ) VALUES (?,?,?,?,?,?,?,?)`);
    return Array.from({ length: size }, (_, index) => {
      const productId = `P${String(index).padStart(3, '0')}`;
      insert.run(productId, `Product ${productId}`, `商品 ${productId}`, `货品 ${productId}`,
        '100', 5, 0.25, index === 0 ? imageUrl : null);
      return { productId, quantity: 1 };
    });
  }
  const savedStock = () => sqlite.prepare('SELECT id,stock FROM products ORDER BY id').all();
  const itemCount = () => sqlite.prepare('SELECT COUNT(*) AS count FROM order_items').get()!.count;

  it('makes the fake D1 enforce the production limit for every query', () => {
    expect(() => new Prepared('SELECT 1').bind(...Array<number>(101).fill(1)))
      .toThrow('at most 100 bound parameters');
  });

  it.each([20, 21, 24, 1000])('saves and replays %i distinct products without exceeding 100 parameters', async (size) => {
    const items = seedCatalog(size);
    const response = await post('orders', { items });
    expect(response.status).toBe(201);
    const original = await response.json() as { items: unknown[]; totalPriceYen: string; totalWeightKg: number; estimatedBoxes: number };
    expect(original.items).toHaveLength(size);
    expect(original.items[0]).toMatchObject({
      productId: 'P000', productName: 'Product P000', productNameJa: '商品 P000', productNameZh: '货品 P000',
      productImageUrl: imageUrl, quantity: 1, unitPriceYen: '100', unitWeightKg: 0.25,
    });
    expect(original.totalPriceYen).toBe(String(size * 100));
    expect(original.totalWeightKg).toBe(size * 0.25);
    expect(original.estimatedBoxes).toBe(Math.max(1, Math.ceil(size * 0.25 / 10)));
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM products WHERE stock <> 4').get()!.count).toBe(0);
    expect(itemCount()).toBe(size);
    const afterCheckout = savedStock();
    const replay = await post('orders', { items: [...items].reverse() });
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(original);
    expect(savedStock()).toEqual(afterCheckout);
    expect(count()).toBe(1);
    expect(maximumBoundParameters).toBeLessThanOrEqual(100);
  });

  it('merges duplicate input products before the large atomic update and keyed replay', async () => {
    const items = seedCatalog(24);
    const firstId = items[0].productId;
    const response = await post('orders', {
      items: [{ productId: firstId, quantity: 1 }, ...items.slice(1), { productId: firstId, quantity: 2 }],
    });
    expect(response.status).toBe(201);
    const original = await response.json() as { items: { productId: string; quantity: number }[]; totalPriceYen: string };
    expect(original.items).toHaveLength(24);
    expect(original.items[0]).toMatchObject({ productId: firstId, quantity: 3 });
    expect(original.totalPriceYen).toBe('2600');
    expect(sqlite.prepare('SELECT stock FROM products WHERE id = ?').get(firstId)!.stock).toBe(2);
    const afterCheckout = savedStock();
    const replay = await post('orders', { items: [{ productId: firstId, quantity: 3 }, ...items.slice(1)] });
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(original);
    expect(savedStock()).toEqual(afterCheckout);
    expect(count()).toBe(1);
  });

  it('atomically exhausts all 24 products when every stock exactly equals the requested quantity', async () => {
    const items = seedCatalog(24);
    sqlite.exec('UPDATE products SET stock = 1');
    const response = await post('orders', { items });
    expect(response.status).toBe(201);
    const original = await response.json();
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM products WHERE stock <> 0').get()!.count).toBe(0);
    expect(count()).toBe(1);
    expect(itemCount()).toBe(24);
    const replay = await post('orders', { items });
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(original);
    expect(count()).toBe(1);
    expect(itemCount()).toBe(24);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM products WHERE stock <> 0').get()!.count).toBe(0);
  });

  it('rolls back the entire large order if the last product runs out before the transaction', async () => {
    const items = seedCatalog(24);
    const lastId = items.at(-1)!.productId;
    beforeBatch = () => { sqlite.prepare('UPDATE products SET stock = 0 WHERE id = ?').run(lastId); };
    const response = await post('orders', { items });
    expect(response.status).toBe(409);
    expect((await response.json() as ErrorResponse).code).toBe('INSUFFICIENT_STOCK');
    expect(count()).toBe(0);
    expect(itemCount()).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM operation_guards').get()!.count).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM products WHERE id <> ? AND stock <> 5').get(lastId)!.count).toBe(0);
    expect(sqlite.prepare('SELECT stock FROM products WHERE id = ?').get(lastId)!.stock).toBe(0);
    // A failed attempt must not reserve its key or leave a partial item snapshot.
    sqlite.prepare('UPDATE products SET stock = 5 WHERE id = ?').run(lastId);
    expect((await post('orders', { items })).status).toBe(201);
    expect(count()).toBe(1);
    expect(itemCount()).toBe(24);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM products WHERE stock <> 4').get()!.count).toBe(0);
  });

  it('commits concurrent retries of the same 24-product order only once', async () => {
    const items = seedCatalog(24);
    const responses = await Promise.all([post('orders', { items }), post('orders', { items })]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const orders = await Promise.all(responses.map((response) => response.json()));
    expect(orders[0]).toEqual(orders[1]);
    expect(count()).toBe(1);
    expect(itemCount()).toBe(24);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM products WHERE stock <> 4').get()!.count).toBe(0);
  });
});

describe('Site authenticated order retries', () => {
  it('uses the same durable keyed ID as Java and Rust', async () => {
    expect(await keyedOrderId('customer', 'checkout_1234567890'))
      .toBe('OI9582a2e4820a8f4d099338f727ce30d03d14583aace592e11346b43066c6e43d');
  });
  it('does not collide for distinct case-sensitive D1 customer accounts', async () => {
    sqlite.exec("INSERT INTO users VALUES ('Customer','unused','CUSTOMER')");
    sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run('upper-session', 'Customer', 'test-token', Math.floor(Date.now() / 1000) + 1800);
    const lower = await post('orders', intent);
    const upper = await post('orders', intent, 'checkout_1234567890', 'upper-session');
    expect([lower.status, upper.status]).toEqual([201, 201]);
    expect((await orderJson(lower)).orderId).not.toBe((await orderJson(upper)).orderId);
    expect(count()).toBe(2);
    expect(stock()).toBe(26);
  });
  it('replays a normalized retry without decrementing stock twice, including deleted products', async () => {
    const first = await post('orders', intent);
    expect(first.status).toBe(201);
    const original = await first.json();
    const duplicate = await post('orders', { items: [{ productId: 'P002', quantity: 1 }, { productId: 'P002', quantity: 1 }] });
    expect(await duplicate.json()).toEqual(original);
    expect(stock()).toBe(28);
    expect(count()).toBe(1);
    sqlite.exec("DELETE FROM products WHERE id='P002'");
    expect(await (await post('orders', intent)).json()).toEqual(original);
  });
  it('rejects key reuse for different content and malformed keys without writes', async () => {
    await post('orders', intent);
    const changed = await post('orders', { items: [{ productId: 'P002', quantity: 1 }] });
    expect(changed.status).toBe(409);
    expect((await changed.json() as ErrorResponse).code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await post('orders', intent, 'short')).status).toBe(400);
    expect(stock()).toBe(28);
    expect(count()).toBe(1);
  });
  it('resolves concurrent duplicates to one committed order', async () => {
    const responses = await Promise.all([post('orders', intent), post('orders', intent)]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const orders = await Promise.all(responses.map((response) => response.json()));
    expect(orders[0]).toEqual(orders[1]);
    expect(stock()).toBe(28);
    expect(count()).toBe(1);
  });
  it('scopes keys to authenticated customer and retains unkeyed behavior', async () => {
    const a = await orderJson(await post('orders', intent));
    const b = await orderJson(await post('orders', intent, 'checkout_1234567890', 'other-session'));
    expect(a.orderId).not.toBe(b.orderId);
    const unkeyed = await Promise.all([post('orders', intent, null), post('orders', intent, null)]);
    expect(unkeyed.map((response) => response.status)).toEqual([201, 201]);
    expect((await orderJson(unkeyed[0])).orderId).not.toBe((await orderJson(unkeyed[1])).orderId);
    expect(count()).toBe(4);
    expect(stock()).toBe(22);
  });
  it('does not reserve a key when stock validation fails', async () => {
    sqlite.exec("UPDATE products SET stock=1 WHERE id='P002'");
    expect((await post('orders', intent)).status).toBe(409);
    expect(count()).toBe(0);
    sqlite.exec("UPDATE products SET stock=3 WHERE id='P002'");
    expect((await post('orders', intent)).status).toBe(201);
    expect(stock()).toBe(1);
  });
  it('registration creates an account without changing the verified session identity', async () => {
    const created = await post('auth/register', { username: 'newcustomer', password: 'pass123' }, null, 'anonymous-session');
    expect(created.status).toBe(201);
    const me = await handleApiRequest(new Request('http://localhost/api/auth/me', {
      headers: { Cookie: 'SMART_INVENTORY_SESSION=anonymous-session' },
    }));
    expect(me.status).toBe(401);
    expect(sqlite.prepare("SELECT username FROM sessions WHERE session_id='anonymous-session'").get()!.username).toBeNull();
  });
  it('rejects overlong UTF-8 passwords before encoding or saving', async () => {
    const response = await post('auth/register', { username: 'newcustomer', password: '中'.repeat(25) }, null, 'anonymous-session');
    expect(response.status).toBe(400);
    expect(sqlite.prepare("SELECT username FROM users WHERE username='newcustomer'").get()).toBeUndefined();
  });
});

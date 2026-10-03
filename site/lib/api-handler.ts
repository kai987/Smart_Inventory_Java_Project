import { compare, hash } from 'bcryptjs';
import { ensureDatabase } from './database';
import { keyedOrderId, sameOrderIntent } from './order-idempotency';
import {
  ApiFault,
  destroySession,
  empty,
  faultResponse,
  getSession,
  json,
  readJson,
  requireCsrf,
  requireUser,
  rotateAuthenticatedSession,
  withSession,
  type SessionContext,
  type UserRecord,
} from './http';
import {
  calculateOrder,
  LOW_STOCK_THRESHOLD,
  normalizeRequestedItems,
  productErrors,
  registrationErrors,
  stockErrors,
  type CalculatedOrder,
  type ProductRecord,
  type RequestedItem,
} from './domain';

type ProductRow = ProductRecord;

type OrderRow = {
  order_id: string;
  customer_name: string;
  total_price_yen: string;
  total_weight_kg: number;
  estimated_boxes: number;
  created_at: string;
};

type OrderItemRow = {
  product_id: string;
  product_name: string;
  unit_price_yen: string;
  unit_weight_kg: number;
  quantity: number;
  subtotal_yen: string;
  total_weight_kg: number;
};

function productResponse(product: ProductRow) {
  return {
    id: product.id,
    name: product.name,
    priceYen: product.price_yen,
    stock: product.stock,
    weightKg: product.weight_kg,
    available: product.stock > 0,
  };
}

function sessionResponse(response: Response, context: SessionContext): Response {
  return withSession(response, context);
}

function escapedLike(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&').toLowerCase()}%`;
}

async function productById(id: string): Promise<ProductRow | null> {
  const database = await ensureDatabase();
  return database.prepare(
    'SELECT id, name, price_yen, stock, weight_kg FROM products WHERE id = ?',
  ).bind(id).first<ProductRow>();
}

async function productsForOrder(items: RequestedItem[]): Promise<ProductRow[]> {
  const database = await ensureDatabase();
  const placeholders = items.map(() => '?').join(', ');
  const result = await database.prepare(
    `SELECT id, name, price_yen, stock, weight_kg FROM products WHERE id IN (${placeholders})`,
  ).bind(...items.map((item) => item.productId)).all<ProductRow>();
  return result.results;
}

async function ordersResponse(whereSql = '', bindings: unknown[] = []) {
  const database = await ensureDatabase();
  const orders = await database.prepare(
    `SELECT order_id, customer_name, total_price_yen, total_weight_kg, estimated_boxes, created_at
     FROM orders ${whereSql} ORDER BY created_at ASC, order_id ASC`,
  ).bind(...bindings).all<OrderRow>();
  const items = await Promise.all(orders.results.map(async (order) => {
    const result = await database.prepare(
      `SELECT product_id, product_name, unit_price_yen, unit_weight_kg,
              quantity, subtotal_yen, total_weight_kg
       FROM order_items WHERE order_id = ? ORDER BY item_order ASC`,
    ).bind(order.order_id).all<OrderItemRow>();
    return {
      orderId: order.order_id,
      customerName: order.customer_name,
      items: result.results.map((item) => ({
        productId: item.product_id,
        productName: item.product_name,
        unitPriceYen: item.unit_price_yen,
        unitWeightKg: item.unit_weight_kg,
        quantity: item.quantity,
        subtotalYen: item.subtotal_yen,
        totalWeightKg: item.total_weight_kg,
      })),
      totalPriceYen: order.total_price_yen,
      totalWeightKg: order.total_weight_kg,
      estimatedBoxes: order.estimated_boxes,
    };
  }));
  return { items, total: items.length };
}

async function authCsrf(request: Request): Promise<Response> {
  const context = await getSession(request, true);
  if (!context) throw new ApiFault(500, 'SESSION_ERROR', 'Unable to create a browser session.');
  return sessionResponse(json({
    token: context.session.csrf_token,
    headerName: 'X-CSRF-TOKEN',
    parameterName: '_csrf',
  }), context);
}

async function authMe(request: Request): Promise<Response> {
  const { context, user } = await requireUser(request);
  return sessionResponse(json({ username: user.username, role: user.role }), context);
}

function loginBody(value: unknown): { username: string; password: string } {
  if (typeof value !== 'object' || value === null) {
    throw new ApiFault(400, 'VALIDATION_ERROR', 'Validation failed.', [
      { field: 'request', message: 'A JSON request body is required.' },
    ]);
  }
  const input = value as Record<string, unknown>;
  if (typeof input.username !== 'string' || input.username.trim() === ''
    || typeof input.password !== 'string' || input.password === '') {
    throw new ApiFault(400, 'VALIDATION_ERROR', 'Validation failed.', [
      ...(typeof input.username !== 'string' || input.username.trim() === ''
        ? [{ field: 'username', message: 'Username is required.' }] : []),
      ...(typeof input.password !== 'string' || input.password === ''
        ? [{ field: 'password', message: 'Password is required.' }] : []),
    ]);
  }
  return { username: input.username, password: input.password };
}

async function authLogin(request: Request): Promise<Response> {
  const context = await requireCsrf(request);
  const credentials = loginBody(await readJson(request));
  const database = await ensureDatabase();
  const user = await database.prepare(
    'SELECT username, password_hash, role FROM users WHERE username = ?',
  ).bind(credentials.username).first<UserRecord>();
  if (new TextEncoder().encode(credentials.password).length > 72
    || !user || !(await compare(credentials.password, user.password_hash))) {
    throw new ApiFault(401, 'AUTHENTICATION_FAILED', 'Invalid username or password.');
  }
  const authenticated = await rotateAuthenticatedSession(context, user.username);
  return sessionResponse(json({ username: user.username, role: user.role }), authenticated);
}

async function authRegister(request: Request): Promise<Response> {
  const context = await requireCsrf(request);
  const input = await readJson(request);
  const errors = registrationErrors(input);
  if (errors.length > 0) throw new ApiFault(400, 'VALIDATION_ERROR', 'Validation failed.', errors);
  const credentials = input as { username: string; password: string };
  const database = await ensureDatabase();
  const existing = await database.prepare('SELECT username FROM users WHERE username = ?')
    .bind(credentials.username).first<{ username: string }>();
  if (existing) throw new ApiFault(409, 'USER_EXISTS', 'A user with this username already exists.');
  const passwordHash = await hash(credentials.password, 10);
  await database.prepare('INSERT INTO users(username, password_hash, role) VALUES (?, ?, ?)')
    .bind(credentials.username, passwordHash, 'CUSTOMER').run();
  // Registration creates an account; explicit login establishes its session.
  return sessionResponse(json({ username: credentials.username, role: 'CUSTOMER' }, 201), context);
}

async function authLogout(request: Request): Promise<Response> {
  const csrf = await requireCsrf(request);
  await requireUser(request);
  const expiredCookie = await destroySession(request, csrf);
  return empty(204, { 'Set-Cookie': expiredCookie });
}

async function listProducts(request: Request): Promise<Response> {
  const database = await ensureDatabase();
  const url = new URL(request.url);
  const query = url.searchParams.get('q')?.trim() ?? '';
  const inStockOnly = url.searchParams.get('inStockOnly') === 'true';
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (query !== '') {
    conditions.push("(LOWER(id) LIKE ? ESCAPE '\\' OR LOWER(name) LIKE ? ESCAPE '\\')");
    const pattern = escapedLike(query);
    bindings.push(pattern, pattern);
  }
  if (inStockOnly) conditions.push('stock > 0');
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const products = await database.prepare(
    `SELECT id, name, price_yen, stock, weight_kg FROM products ${where} ORDER BY id ASC`,
  ).bind(...bindings).all<ProductRow>();
  return json({ items: products.results.map(productResponse), total: products.results.length });
}

async function getProduct(id: string): Promise<Response> {
  const product = await productById(id);
  if (!product) throw new ApiFault(404, 'PRODUCT_NOT_FOUND', 'Product was not found.');
  return json(productResponse(product));
}

async function createProduct(request: Request): Promise<Response> {
  const csrf = await requireCsrf(request);
  await requireUser(request, 'ADMIN');
  const input = await readJson(request);
  const errors = productErrors(input);
  if (errors.length > 0) throw new ApiFault(400, 'VALIDATION_ERROR', 'Validation failed.', errors);
  const product = input as { id: string; name: string; priceYen: string; stock: number; weightKg: number };
  if (await productById(product.id)) throw new ApiFault(409, 'PRODUCT_EXISTS', 'A product with this ID already exists.');
  const database = await ensureDatabase();
  await database.prepare(
    'INSERT INTO products(id, name, price_yen, stock, weight_kg) VALUES (?, ?, ?, ?, ?)',
  ).bind(product.id, product.name.trim(), product.priceYen, product.stock, product.weightKg).run();
  return sessionResponse(json(productResponse({
    id: product.id,
    name: product.name.trim(),
    price_yen: product.priceYen,
    stock: product.stock,
    weight_kg: product.weightKg,
  }), 201), csrf);
}

async function updateProductStock(request: Request, id: string): Promise<Response> {
  const csrf = await requireCsrf(request);
  await requireUser(request, 'ADMIN');
  const input = await readJson(request);
  const errors = stockErrors(input);
  if (errors.length > 0) throw new ApiFault(400, 'VALIDATION_ERROR', 'Validation failed.', errors);
  if (!await productById(id)) throw new ApiFault(404, 'PRODUCT_NOT_FOUND', 'Product was not found.');
  const stock = (input as { stock: number }).stock;
  const database = await ensureDatabase();
  await database.prepare('UPDATE products SET stock = ? WHERE id = ?').bind(stock, id).run();
  const updated = await productById(id);
  if (!updated) throw new ApiFault(404, 'PRODUCT_NOT_FOUND', 'Product was not found.');
  return sessionResponse(json(productResponse(updated)), csrf);
}

async function deleteProduct(request: Request, id: string): Promise<Response> {
  const csrf = await requireCsrf(request);
  await requireUser(request, 'ADMIN');
  if (!await productById(id)) throw new ApiFault(404, 'PRODUCT_NOT_FOUND', 'Product was not found.');
  const database = await ensureDatabase();
  await database.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
  return sessionResponse(empty(), csrf);
}

async function persistOrder(customerName: string, requestedItems: RequestedItem[], order: CalculatedOrder,
  keyedId: string | null): Promise<string> {
  const database = await ensureDatabase();
  const orderId = keyedId ?? `O${crypto.randomUUID().replaceAll('-', '')}`;
  const guardId = crypto.randomUUID();
  const ids = requestedItems.map((item) => item.productId);
  const caseSql = requestedItems.map(() => 'WHEN ? THEN ?').join(' ');
  const placeholders = requestedItems.map(() => '?').join(', ');
  const insufficientSql = requestedItems.map(() => '(check_product.id = ? AND check_product.stock < ?)').join(' OR ');
  const updateSql = `UPDATE products
    SET stock = stock - CASE id ${caseSql} ELSE 0 END
    WHERE id IN (${placeholders})
      AND NOT EXISTS (SELECT 1 FROM products AS check_product WHERE ${insufficientSql})`;
  const updateBindings = [
    ...requestedItems.flatMap((item) => [item.productId, item.quantity]),
    ...ids,
    ...requestedItems.flatMap((item) => [item.productId, item.quantity]),
  ];
  const statements = [
    database.prepare(
      `INSERT INTO orders(order_id, customer_name, total_price_yen, total_weight_kg, estimated_boxes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(orderId, customerName, order.totalPriceYen, order.totalWeightKg, order.estimatedBoxes, new Date().toISOString()),
    ...order.items.map((item, index) => database.prepare(
      `INSERT INTO order_items(
        order_id, item_order, product_id, product_name, unit_price_yen,
        unit_weight_kg, quantity, subtotal_yen, total_weight_kg
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      orderId, index, item.productId, item.productName, item.unitPriceYen,
      item.unitWeightKg, item.quantity, item.subtotalYen, item.totalWeightKg,
    )),
    database.prepare(updateSql).bind(...updateBindings),
    database.prepare(
      'INSERT INTO operation_guards(id, ok) VALUES (?, CASE WHEN changes() = ? THEN 1 ELSE 0 END)',
    ).bind(guardId, requestedItems.length),
    database.prepare('DELETE FROM operation_guards WHERE id = ?').bind(guardId),
  ];
  await database.batch(statements);
  return orderId;
}

async function createOrder(request: Request): Promise<Response> {
  const csrf = await requireCsrf(request);
  const { user } = await requireUser(request, 'CUSTOMER');
  const normalized = normalizeRequestedItems(await readJson(request));
  if (normalized.errors.length > 0) throw new ApiFault(400, 'VALIDATION_ERROR', 'Validation failed.', normalized.errors);
  let keyedId: string | null;
  try {
    keyedId = await keyedOrderId(user.username, request.headers.get('Idempotency-Key'));
  } catch {
    throw new ApiFault(400, 'VALIDATION_ERROR', 'Idempotency-Key must contain 16-128 letters, digits, underscores or hyphens.');
  }
  const replay = async () => {
    if (keyedId === null) return null;
    const saved = (await ordersResponse('WHERE order_id = ? AND customer_name = ?', [keyedId, user.username])).items[0];
    if (saved === undefined) return null;
    if (!sameOrderIntent(saved.items, normalized.items)) {
      throw new ApiFault(409, 'IDEMPOTENCY_CONFLICT', 'This checkout key was already used for a different order.');
    }
    return saved;
  };
  const previous = await replay();
  if (previous !== null) return sessionResponse(json(previous, 201), csrf);
  const products = await productsForOrder(normalized.items);
  let calculated: CalculatedOrder;
  try {
    calculated = calculateOrder(products, normalized.items);
  } catch (error: unknown) {
    const concurrent = await replay();
    if (concurrent !== null) return sessionResponse(json(concurrent, 201), csrf);
    const message = error instanceof Error ? error.message : '';
    const [code, productId] = message.split(':');
    if (code === 'PRODUCT_NOT_FOUND') throw new ApiFault(404, code, `Product ${productId} was not found.`);
    if (code === 'INSUFFICIENT_STOCK') {
      const index = normalized.items.findIndex((item) => item.productId === productId);
      throw new ApiFault(409, code, `Insufficient stock for ${productId}.`, [
        { field: `items[${Math.max(index, 0)}].quantity`, message: 'Requested quantity exceeds current stock.' },
      ]);
    }
    throw error;
  }
  let orderId: string;
  try {
    orderId = await persistOrder(user.username, normalized.items, calculated, keyedId);
  } catch {
    // Another request with this key may have committed between lookup and INSERT.
    // D1 batch is transactional, so its duplicate primary key rolls back all writes.
    const concurrent = await replay();
    if (concurrent !== null) return sessionResponse(json(concurrent, 201), csrf);
    const currentProducts = await productsForOrder(normalized.items);
    try {
      calculateOrder(currentProducts, normalized.items);
    } catch {
      throw new ApiFault(409, 'INSUFFICIENT_STOCK', 'Stock changed before the order could be saved. Please review your cart.');
    }
    throw new ApiFault(500, 'PERSISTENCE_ERROR', 'The order could not be saved. No inventory was changed.');
  }
  const response = {
    orderId,
    customerName: user.username,
    ...calculated,
  };
  return sessionResponse(json(response, 201), csrf);
}

async function myOrders(request: Request): Promise<Response> {
  const { context, user } = await requireUser(request, 'CUSTOMER');
  return sessionResponse(json(await ordersResponse('WHERE customer_name = ?', [user.username])), context);
}

async function allOrders(request: Request): Promise<Response> {
  const { context } = await requireUser(request, 'ADMIN');
  const customer = new URL(request.url).searchParams.get('customer')?.trim() ?? '';
  const response = customer === ''
    ? await ordersResponse()
    : await ordersResponse("WHERE LOWER(customer_name) LIKE ? ESCAPE '\\'", [escapedLike(customer)]);
  return sessionResponse(json(response), context);
}

async function adminSummary(request: Request): Promise<Response> {
  const { context } = await requireUser(request, 'ADMIN');
  const database = await ensureDatabase();
  const products = await database.prepare(
    'SELECT id, name, price_yen, stock, weight_kg FROM products ORDER BY id',
  ).all<ProductRow>();
  const orderCount = await database.prepare('SELECT COUNT(*) AS count FROM orders').first<{ count: number }>();
  const customerCount = await database.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'CUSTOMER'")
    .first<{ count: number }>();
  const totalStock = products.results.reduce((total, product) => total + product.stock, 0);
  const lowStockCount = products.results.filter((product) => product.stock <= LOW_STOCK_THRESHOLD).length;
  const inventoryValue = products.results.reduce(
    (total, product) => total + BigInt(product.price_yen) * BigInt(product.stock), 0n,
  );
  return sessionResponse(json({
    productCount: products.results.length,
    totalStock,
    orderCount: orderCount?.count ?? 0,
    customerCount: customerCount?.count ?? 0,
    lowStockCount,
    lowStockThreshold: LOW_STOCK_THRESHOLD,
    inventoryValueYen: inventoryValue.toString(),
  }), context);
}

function routeParts(request: Request): string[] {
  return new URL(request.url).pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
}

async function dispatch(request: Request): Promise<Response> {
  await ensureDatabase();
  const method = request.method.toUpperCase();
  const parts = routeParts(request);
  if (method === 'GET' && parts.join('/') === 'auth/csrf') return authCsrf(request);
  if (method === 'GET' && parts.join('/') === 'auth/me') return authMe(request);
  if (method === 'POST' && parts.join('/') === 'auth/login') return authLogin(request);
  if (method === 'POST' && parts.join('/') === 'auth/register') return authRegister(request);
  if (method === 'POST' && parts.join('/') === 'auth/logout') return authLogout(request);
  if (parts[0] === 'products' && parts.length === 1 && method === 'GET') return listProducts(request);
  if (parts[0] === 'products' && parts.length === 1 && method === 'POST') return createProduct(request);
  if (parts[0] === 'products' && parts.length === 2 && method === 'GET') return getProduct(parts[1]);
  if (parts[0] === 'products' && parts.length === 3 && parts[2] === 'stock' && method === 'PATCH') {
    return updateProductStock(request, parts[1]);
  }
  if (parts[0] === 'products' && parts.length === 2 && method === 'DELETE') return deleteProduct(request, parts[1]);
  if (parts.join('/') === 'orders/me' && method === 'GET') return myOrders(request);
  if (parts.length === 1 && parts[0] === 'orders' && method === 'GET') return allOrders(request);
  if (parts.length === 1 && parts[0] === 'orders' && method === 'POST') return createOrder(request);
  if (parts.join('/') === 'admin/summary' && method === 'GET') return adminSummary(request);
  throw new ApiFault(404, 'NOT_FOUND', 'The requested resource was not found.');
}

export async function handleApiRequest(request: Request): Promise<Response> {
  try {
    return await dispatch(request);
  } catch (error: unknown) {
    if (error instanceof ApiFault) return faultResponse(error, request);
    console.error('Smart Inventory API request failed.', error instanceof Error ? error.message : 'Unknown error');
    return faultResponse(new ApiFault(500, 'INTERNAL_ERROR', 'An unexpected server error occurred.'), request);
  }
}

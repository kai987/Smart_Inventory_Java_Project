import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  username: text('username').primaryKey(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['ADMIN', 'CUSTOMER'] }).notNull(),
}, (table) => [check('users_role_check', sql`${table.role} IN ('ADMIN', 'CUSTOMER')`)]);

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  priceYen: text('price_yen').notNull(),
  stock: integer('stock').notNull(),
  weightKg: real('weight_kg').notNull(),
}, (table) => [
  check('products_stock_check', sql`${table.stock} >= 0`),
  check('products_weight_check', sql`${table.weightKg} > 0`),
]);

export const orders = sqliteTable('orders', {
  orderId: text('order_id').primaryKey(),
  customerName: text('customer_name').notNull().references(() => users.username),
  totalPriceYen: text('total_price_yen').notNull(),
  totalWeightKg: real('total_weight_kg').notNull(),
  estimatedBoxes: integer('estimated_boxes').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_orders_customer_created').on(table.customerName, table.createdAt),
  check('orders_weight_check', sql`${table.totalWeightKg} >= 0`),
  check('orders_boxes_check', sql`${table.estimatedBoxes} >= 1`),
]);

export const orderItems = sqliteTable('order_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: text('order_id').notNull().references(() => orders.orderId, { onDelete: 'cascade' }),
  itemOrder: integer('item_order').notNull(),
  productId: text('product_id').notNull(),
  productName: text('product_name').notNull(),
  unitPriceYen: text('unit_price_yen').notNull(),
  unitWeightKg: real('unit_weight_kg').notNull(),
  quantity: integer('quantity').notNull(),
  subtotalYen: text('subtotal_yen').notNull(),
  totalWeightKg: real('total_weight_kg').notNull(),
}, (table) => [
  uniqueIndex('idx_order_items_order_position').on(table.orderId, table.itemOrder),
  check('order_items_quantity_check', sql`${table.quantity} > 0`),
  check('order_items_weight_check', sql`${table.unitWeightKg} > 0 AND ${table.totalWeightKg} > 0`),
]);

export const sessions = sqliteTable('sessions', {
  sessionId: text('session_id').primaryKey(),
  username: text('username').references(() => users.username, { onDelete: 'cascade' }),
  csrfToken: text('csrf_token').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (table) => [index('idx_sessions_expires_at').on(table.expiresAt)]);

export const operationGuards = sqliteTable('operation_guards', {
  id: text('id').primaryKey(),
  ok: integer('ok').notNull(),
}, (table) => [check('operation_guards_ok_check', sql`${table.ok} = 1`)]);

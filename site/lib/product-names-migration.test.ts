import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('additive multilingual name migration', () => {
  it('adds nullable product and order snapshot columns without changing existing records', () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      sqlite.exec('PRAGMA foreign_keys=ON');
      sqlite.exec(readFileSync(new URL('../drizzle/0000_dashing_betty_brant.sql', import.meta.url), 'utf8')
        .replaceAll('--> statement-breakpoint', ''));
      sqlite.exec(`
        INSERT INTO users VALUES ('existing','unused','CUSTOMER');
        INSERT INTO products VALUES ('P900','Original Custom Mug','1200',7,0.3);
        INSERT INTO orders VALUES ('saved-order','existing','2400',0.6,1,'2026-01-01T00:00:00Z');
        INSERT INTO order_items(order_id,item_order,product_id,product_name,unit_price_yen,unit_weight_kg,quantity,subtotal_yen,total_weight_kg)
          VALUES ('saved-order',0,'P900','Historical Custom Mug','1200',0.3,2,'2400',0.6);
      `);
      const inventory = sqlite.prepare('SELECT * FROM products').all();
      const snapshots = sqlite.prepare('SELECT * FROM order_items').all();
      const orders = sqlite.prepare('SELECT * FROM orders').all();
      const migration = readFileSync(new URL('../drizzle/0001_busy_echo.sql', import.meta.url), 'utf8');
      expect(migration.split('--> statement-breakpoint').every((statement) => /^\s*ALTER TABLE `(products|order_items)` ADD `(name_ja|name_zh|product_name_ja|product_name_zh)` text;\s*$/.test(statement))).toBe(true);
      sqlite.exec(migration.replaceAll('--> statement-breakpoint', ''));
      expect(sqlite.prepare('SELECT id,name,price_yen,stock,weight_kg FROM products').all()).toEqual(inventory);
      expect(sqlite.prepare('SELECT id,order_id,item_order,product_id,product_name,unit_price_yen,unit_weight_kg,quantity,subtotal_yen,total_weight_kg FROM order_items').all()).toEqual(snapshots);
      expect(sqlite.prepare('SELECT * FROM orders').all()).toEqual(orders);
      expect(sqlite.prepare('SELECT name_ja,name_zh FROM products').get()).toEqual({ name_ja: null, name_zh: null });
      expect(sqlite.prepare('SELECT product_name_ja,product_name_zh FROM order_items').get())
        .toEqual({ product_name_ja: null, product_name_zh: null });
      for (const [table, fields] of [['products', ['name_ja', 'name_zh']], ['order_items', ['product_name_ja', 'product_name_zh']]] as const) {
        const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all();
        for (const field of fields) expect(columns.find((column) => column.name === field)).toMatchObject({ notnull: 0, dflt_value: null });
      }
    } finally {
      sqlite.close();
    }
  });
});

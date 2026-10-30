import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('additive product category and image migration', () => {
  it('adds only nullable metadata columns and preserves existing inventory and order snapshots', () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      for (const name of ['0000_dashing_betty_brant', '0001_busy_echo']) {
        sqlite.exec(readFileSync(new URL(`../drizzle/${name}.sql`, import.meta.url), 'utf8').replaceAll('--> statement-breakpoint', ''));
      }
      sqlite.exec(`
        INSERT INTO users VALUES ('existing','unused','CUSTOMER');
        INSERT INTO products(id,name,price_yen,stock,weight_kg,name_ja,name_zh)
          VALUES ('P900','Custom Mug','1200',7,0.3,'カスタムマグ','定制杯');
        INSERT INTO orders VALUES ('saved-order','existing','2400',0.6,1,'2026-01-01T00:00:00Z');
        INSERT INTO order_items(order_id,item_order,product_id,product_name,unit_price_yen,unit_weight_kg,quantity,subtotal_yen,total_weight_kg,product_name_ja,product_name_zh)
          VALUES ('saved-order',0,'P900','Historical Mug','1200',0.3,2,'2400',0.6,'以前のマグ','历史杯');
      `);
      const beforeProduct = sqlite.prepare('SELECT * FROM products').get();
      const beforeItem = sqlite.prepare('SELECT * FROM order_items').get();
      const beforeOrders = sqlite.prepare('SELECT * FROM orders').all();
      const migration = readFileSync(new URL('../drizzle/0002_chunky_paladin.sql', import.meta.url), 'utf8');
      expect(migration.split('--> statement-breakpoint').every((statement) => /^\s*ALTER TABLE `(products|order_items)` ADD `(category|image_url|product_image_url)` text;\s*$/.test(statement))).toBe(true);
      sqlite.exec(migration.replaceAll('--> statement-breakpoint', ''));
      expect(sqlite.prepare('SELECT * FROM products').get()).toEqual({ ...beforeProduct, category: null, image_url: null });
      expect(sqlite.prepare('SELECT * FROM order_items').get()).toEqual({ ...beforeItem, product_image_url: null });
      expect(sqlite.prepare('SELECT * FROM orders').all()).toEqual(beforeOrders);
      for (const [table, fields] of [['products', ['category', 'image_url']], ['order_items', ['product_image_url']]] as const) {
        const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all();
        for (const field of fields) expect(columns.find((column) => column.name === field)).toMatchObject({ notnull: 0, dflt_value: null });
      }
    } finally { sqlite.close(); }
  });
});

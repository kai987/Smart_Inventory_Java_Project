/** Permanent version marker: unlike transaction guards, this row must remain. */
export const CATALOG_EXPANSION_VERSION = 'catalog:expanded-products:v1';

// Existing P001–P004 records, inventory changes, and historical orders are never
// rewritten by this expansion. Prices remain decimal strings throughout the API.
export const catalogExpansionProducts = [
  ['P005', 'Desk Lamp', '3200', 24, 0.8],
  ['P006', 'Robot Vacuum', '24800', 10, 3.2],
  ['P007', 'Desk Fan', '4500', 18, 1.1],
  ['P008', 'Digital Alarm Clock', '2200', 30, 0.3],
  ['P009', 'Electric Kettle', '5800', 20, 1.0],
  ['P010', 'Frying Pan', '3600', 16, 0.9],
  ['P011', 'Stainless Steel Bottle', '2400', 36, 0.35],
  ['P012', 'Digital Kitchen Scale', '1800', 22, 0.4],
  ['P013', 'Travel Backpack', '6800', 25, 0.7],
  ['P014', 'Cabin Suitcase', '12800', 12, 2.8],
  ['P015', 'Compact Umbrella', '1900', 40, 0.25],
  ['P016', 'Toiletry Bag', '2600', 28, 0.3],
  ['P017', 'Yoga Mat', '3400', 24, 1.2],
  ['P018', 'Dumbbell Set', '7900', 15, 5.0],
  ['P019', 'Jump Rope', '1200', 32, 0.2],
  ['P020', 'Basketball', '4200', 18, 0.65],
  ['P021', 'Notebook Set', '1500', 45, 0.6],
  ['P022', 'Gel Pen Set', '900', 60, 0.15],
  ['P023', 'Desk Organizer', '2800', 20, 0.5],
  ['P024', 'Pencil Case', '1600', 35, 0.2],
] as const;

/** Apply this catalog version once, without overriding any existing product. */
export async function ensureExpandedCatalog(database: D1Database): Promise<void> {
  const completed = await database.prepare('SELECT id FROM operation_guards WHERE id = ?')
    .bind(CATALOG_EXPANSION_VERSION).first<{ id: string }>();
  if (completed !== null) return;

  const guardId = `catalog-bootstrap:${crypto.randomUUID()}`;
  await database.batch([
    // The first read may race another isolate; the transactional claim is the
    // authority. Losing isolates execute no product writes, including after a
    // user deletes a newly added product between two bootstrap batches.
    database.prepare(`INSERT INTO operation_guards(id, ok)
      SELECT ?, 1 WHERE NOT EXISTS (SELECT 1 FROM operation_guards WHERE id = ?)`)
      .bind(guardId, CATALOG_EXPANSION_VERSION),
    ...catalogExpansionProducts.map((product) => database.prepare(
      `INSERT OR IGNORE INTO products(id, name, price_yen, stock, weight_kg)
       SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM operation_guards WHERE id = ?)`,
    ).bind(...product, guardId)),
    database.prepare(`INSERT OR IGNORE INTO operation_guards(id, ok)
      SELECT ?, 1 WHERE EXISTS (SELECT 1 FROM operation_guards WHERE id = ?)`)
      .bind(CATALOG_EXPANSION_VERSION, guardId),
    database.prepare('DELETE FROM operation_guards WHERE id = ?').bind(guardId),
  ]);
}

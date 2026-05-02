const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  const orphanPrefixes = ['Contacts E2E ', 'Test Brand '];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const prefix of orphanPrefixes) {
      const found = await client.query(
        "SELECT id, name FROM brands WHERE name LIKE $1",
        [prefix + '%']
      );
      for (const row of found.rows) {
        console.log('Deleting orphan brand:', row.id, row.name);
        await client.query("UPDATE client_contacts SET brand_id = NULL WHERE brand_id = $1", [row.id]);
        await client.query("UPDATE clients          SET brand_id = NULL WHERE brand_id = $1", [row.id]);
        await client.query("DELETE FROM contact_tag_assignments WHERE tag_id IN (SELECT id FROM contact_tags WHERE brand_id = $1)", [row.id]);
        await client.query("DELETE FROM contact_tags     WHERE brand_id = $1", [row.id]);
        await client.query("DELETE FROM contact_activities WHERE brand_id = $1", [row.id]);
        await client.query("DELETE FROM contact_imports  WHERE brand_id = $1", [row.id]);
        await client.query("DELETE FROM brands           WHERE id       = $1", [row.id]);
      }
    }
    await client.query('COMMIT');
    console.log('Orphan cleanup committed.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Orphan cleanup ROLLED BACK:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const app = require('./app');
const { pool } = require('./pool');

// Render's free plan has no shell, so the server creates the tables itself the
// first time it starts against an empty database. If the tables already exist
// it does nothing, so restarting is always safe.
async function ensureSchema() {
  const check = await pool.query("SELECT to_regclass('public.users') AS t");
  if (check.rows[0].t) {
    console.log('Database tables already exist.');
    return;
  }
  console.log('Empty database found - creating tables...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const file of ['schema.sql', 'credits_schema.sql']) {
      await client.query(fs.readFileSync(path.join(__dirname, file), 'utf8'));
    }
    await client.query('COMMIT');
    console.log('Tables created.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const port = process.env.PORT || 4000;
ensureSchema()
  .then(() => {
    app.listen(port, () => console.log(`CA & AI API listening on port ${port}`));
  })
  .catch((err) => {
    console.error('Startup failed:', err.message);
    process.exit(1);
  });

const { randomBytes, scrypt } = require('node:crypto');
const { promisify } = require('node:util');
const { Client } = require('pg');

async function seed() {
  const { DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!DATABASE_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
    throw new Error('Set DATABASE_URL, ADMIN_EMAIL and ADMIN_PASSWORD (minimum 12 characters)');
  }
  const salt = randomBytes(16).toString('hex');
  const hash = (await promisify(scrypt)(ADMIN_PASSWORD, salt, 64)).toString('hex');
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(
      `INSERT INTO users (email, name, password_hash, role, email_verified_at)
       VALUES ($1, 'Admin', $2, 'ADMIN', now())
       ON CONFLICT (email) DO NOTHING`,
      [ADMIN_EMAIL.trim().toLowerCase(), `${salt}:${hash}`],
    );
    if (!result.rowCount) throw new Error('Admin email is already in use');
    console.log('Admin account created');
  } finally {
    await client.end();
  }
}

seed().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

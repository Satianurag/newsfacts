/**
 * Postgres (Neon or any pgvector-compatible database).
 * @see https://neon.com/docs/extensions/pgvector
 * @see https://neon.com/docs/connect/connect-from-any-app
 */
import './loadEnv.js';
import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      'DATABASE_URL is required. Use a Neon connection string or local Postgres with pgvector.',
    );
  }
  return url;
}

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: requireDatabaseUrl(),
      ssl: process.env.DATABASE_SSL === '0' ? false : undefined,
    });
  }
  return pool;
}

export type FactRow = {
  id: string;
  text: string;
  summary: string;
  author: string;
  location: string;
  created_at: string;
  price_hbar: string;
  creator_address: string | null;
  text_normalized: string;
  photo_cids: FactPhotoRow[] | null;
  hcs_topic_id: string | null;
  hcs_tx_id: string | null;
};

export type FactPhotoRow = {
  cid: string;
  name: string;
  mimeType: string;
  url: string;
};

export async function initDatabase() {
  const client = await getPool().connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    await client.query(`
      CREATE TABLE IF NOT EXISTS facts (
        id UUID PRIMARY KEY,
        text TEXT NOT NULL,
        summary TEXT NOT NULL,
        author TEXT NOT NULL,
        location TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        price_hbar TEXT NOT NULL,
        creator_address TEXT,
        text_normalized TEXT NOT NULL UNIQUE,
        embedding vector(384) NOT NULL
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS facts_embedding_idx
      ON facts USING hnsw (embedding vector_cosine_ops)
    `);
    await client.query(`
      ALTER TABLE facts
      ADD COLUMN IF NOT EXISTS photo_cids JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
    await client.query(`
      ALTER TABLE facts
      ADD COLUMN IF NOT EXISTS hcs_topic_id TEXT
    `);
    await client.query(`
      ALTER TABLE facts
      ADD COLUMN IF NOT EXISTS hcs_tx_id TEXT
    `);
  } finally {
    client.release();
  }
}

export function toVectorLiteral(values: number[]) {
  return `[${values.join(',')}]`;
}

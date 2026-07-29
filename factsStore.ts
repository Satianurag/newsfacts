import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from '@xenova/transformers';
import { getPool, initDatabase, toVectorLiteral, type FactPhotoRow, type FactRow } from './db';
import type { FactPhoto } from './pinataStore';

export type FactRecord = {
  id: string;
  text: string;
  summary: string;
  author: string;
  location: string;
  createdAt: string;
  priceUsd: string;
  creatorAddress?: string;
  embedding: number[];
  photos: FactPhoto[];
  hcsTopicId?: string;
  hcsTxId?: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEGACY_DATA_PATH = path.join(__dirname, 'data', 'facts.json');
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

let extractorPromise: Promise<unknown> | null = null;
let initialized = false;

function normalizeFactText(text: string) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', MODEL_NAME, {
      quantized: true,
    });
  }
  return extractorPromise;
}

function summarize(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 160) return clean;
  return `${clean.slice(0, 157)}...`;
}

async function embed(text: string) {
  const extractor = (await getExtractor()) as (
    input: string,
    options: { pooling: 'mean'; normalize: boolean },
  ) => Promise<{ data: Float32Array | number[] }>;

  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

function parsePhotos(value: FactPhotoRow[] | string | null | undefined): FactPhoto[] {
  if (!value) return [];
  const rows = typeof value === 'string' ? (JSON.parse(value) as FactPhotoRow[]) : value;
  if (!Array.isArray(rows)) return [];
  return rows.map((photo) => ({
    cid: photo.cid,
    name: photo.name,
    mimeType: photo.mimeType,
    url: photo.url,
  }));
}

function rowToFact(row: FactRow, embedding: number[] = []): FactRecord {
  return {
    id: row.id,
    text: row.text,
    summary: row.summary,
    author: row.author,
    location: row.location,
    createdAt: new Date(row.created_at).toISOString(),
    priceUsd: row.price_hbar,
    creatorAddress: row.creator_address ?? undefined,
    embedding,
    photos: parsePhotos(row.photo_cids),
    hcsTopicId: row.hcs_topic_id ?? undefined,
    hcsTxId: row.hcs_tx_id ?? undefined,
  };
}

async function importLegacyFactsIfEmpty() {
  const pool = getPool();
  const countResult = await pool.query('SELECT COUNT(*)::int AS count FROM facts');
  const count = countResult.rows[0]?.count ?? 0;
  if (count > 0) return;

  try {
    const raw = await fs.readFile(LEGACY_DATA_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as FactRecord[];
    if (!Array.isArray(parsed) || parsed.length === 0) return;

    for (const fact of parsed) {
      const textNormalized = normalizeFactText(fact.text);
      const embedding = fact.embedding?.length
        ? fact.embedding
        : await embed(fact.text);
      const vector = toVectorLiteral(embedding);

      await pool.query(
        `INSERT INTO facts (
          id, text, summary, author, location, created_at, price_hbar,
          creator_address, text_normalized, embedding
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector)
        ON CONFLICT (text_normalized) DO NOTHING`,
        [
          fact.id,
          fact.text,
          fact.summary,
          fact.author,
          fact.location,
          fact.createdAt,
          fact.priceUsd,
          fact.creatorAddress ?? null,
          textNormalized,
          vector,
        ],
      );
    }

    console.log(`Imported ${parsed.length} legacy facts from data/facts.json`);
  } catch (error) {
    const message = (error as Error).message ?? '';
    if (!message.includes('no such file')) {
      console.warn('Legacy facts import skipped:', message);
    }
  }
}

export async function initFactsStore() {
  if (initialized) return;
  await initDatabase();
  await importLegacyFactsIfEmpty();
  initialized = true;
}

export async function addFact(input: {
  text: string;
  author: string;
  location: string;
  priceUsd: string;
  creatorAddress?: string;
}) {
  const pool = getPool();
  const textNormalized = normalizeFactText(input.text);

  const existing = await pool.query(
    `SELECT id, text, summary, author, location, created_at, price_hbar, creator_address, text_normalized, photo_cids, hcs_topic_id, hcs_tx_id
     FROM facts WHERE text_normalized = $1 LIMIT 1`,
    [textNormalized],
  );
  if (existing.rows.length > 0) {
    return rowToFact(existing.rows[0] as FactRow);
  }

  const createdAt = new Date().toISOString();
  const summary = summarize(input.text);
  const embedding = await embed(input.text);
  const id = randomUUID();
  const vector = toVectorLiteral(embedding);

  await pool.query(
    `INSERT INTO facts (
      id, text, summary, author, location, created_at, price_hbar,
      creator_address, text_normalized, embedding
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector)`,
    [
      id,
      input.text,
      summary,
      input.author,
      input.location,
      createdAt,
      input.priceUsd,
      input.creatorAddress ?? null,
      textNormalized,
      vector,
    ],
  );

  return {
    id,
    text: input.text,
    summary,
    author: input.author,
    location: input.location,
    createdAt,
    priceUsd: input.priceUsd,
    creatorAddress: input.creatorAddress,
    embedding,
    photos: [],
    hcsTopicId: undefined,
    hcsTxId: undefined,
  } satisfies FactRecord;
}

export async function saveHcsAnchor(
  factId: string,
  anchor: { topicId: string; transactionId: string },
) {
  const pool = getPool();
  await pool.query(
    `UPDATE facts SET hcs_topic_id = $2, hcs_tx_id = $3 WHERE id = $1::uuid`,
    [factId, anchor.topicId, anchor.transactionId],
  );
}

export async function attachPhotosToFact(factId: string, photos: FactPhoto[]) {
  if (!photos.length) return [];
  const pool = getPool();
  const existing = await getFactById(factId);
  if (!existing) return null;

  const merged = [...existing.photos, ...photos];
  await pool.query(`UPDATE facts SET photo_cids = $2::jsonb WHERE id = $1::uuid`, [
    factId,
    JSON.stringify(merged),
  ]);
  return merged;
}

export async function searchFacts(query: string, limit: number) {
  const pool = getPool();
  const queryEmbedding = await embed(query);
  const vector = toVectorLiteral(queryEmbedding);

  const result = await pool.query(
    `SELECT
      id, text, summary, author, location, created_at, price_hbar, creator_address, text_normalized, photo_cids, hcs_topic_id, hcs_tx_id,
      1 - (embedding <=> $1::vector) AS score
    FROM facts
    ORDER BY embedding <=> $1::vector
    LIMIT $2`,
    [vector, limit],
  );

  return result.rows.map((row) => ({
    fact: rowToFact(row as FactRow),
    score: Number((row as { score: string }).score),
  }));
}

export async function getFactById(id: string) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, text, summary, author, location, created_at, price_hbar, creator_address, text_normalized, photo_cids, hcs_topic_id, hcs_tx_id
     FROM facts WHERE id = $1::uuid LIMIT 1`,
    [id],
  );
  if (!result.rows.length) return undefined;
  return rowToFact(result.rows[0] as FactRow);
}

export async function getFactsCount() {
  const pool = getPool();
  const result = await pool.query('SELECT COUNT(*)::int AS count FROM facts');
  return Number(result.rows[0]?.count ?? 0);
}

export async function updateFact(
  id: string,
  updates: Partial<Omit<FactRecord, 'id'>>,
) {
  const existing = await getFactById(id);
  if (!existing) return null;

  const next = { ...existing, ...updates };
  const pool = getPool();
  const textNormalized = normalizeFactText(next.text);
  const embedding = updates.text ? await embed(next.text) : existing.embedding;
  const vector = toVectorLiteral(embedding);

  await pool.query(
    `UPDATE facts
     SET text = $2, summary = $3, author = $4, location = $5, price_hbar = $6,
         creator_address = $7, text_normalized = $8, embedding = $9::vector
     WHERE id = $1::uuid`,
    [
      id,
      next.text,
      next.summary,
      next.author,
      next.location,
      next.priceUsd,
      next.creatorAddress ?? null,
      textNormalized,
      vector,
    ],
  );

  return next;
}

export async function resetFacts() {
  const pool = getPool();
  await pool.query('DELETE FROM facts');
}

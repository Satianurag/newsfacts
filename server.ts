/**
 * NewsFacts Seller + Local Vector Store
 *
 * - Free: Submit facts and search summaries
 * - Paid: Fetch full fact details (x402 on Hedera)
 */

import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  addFact,
  attachPhotosToFact,
  getFactById,
  getFactsCount,
  initFactsStore,
  saveHcsAnchor,
  searchFacts,
  resetFacts,
  type FactRecord,
} from './factsStore';
import { isPinataConfigured, uploadFactPhoto } from './pinataStore';
import { anchorFactOnHcs, isHcsConfigured } from './hcsAnchor';
import { hederaConfig, mountPaidRoutes } from './x402Server';
import { renderStudioPage } from './ui/studioPage';

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype.startsWith('image/')) {
      callback(null, true);
      return;
    }
    callback(new Error('Only image uploads are allowed.'));
  },
});

// ============================================================================
// CONFIGURATION
// ============================================================================

const PORT = Number(process.env.PORT ?? 3002);
const HOST = process.env.HOST ?? '0.0.0.0';
const REOWN_PROJECT_ID = process.env.REOWN_PROJECT_ID ?? '';
const SELLER_ACCOUNT_ID = hederaConfig.SELLER_ACCOUNT_ID;
const FACT_PRICE_HBAR = hederaConfig.FACT_PRICE_HBAR;
const FACT_PRICE_LABEL = `${FACT_PRICE_HBAR} HBAR`;
const DEFAULT_CREATOR_ACCOUNT_ID = process.env.DEFAULT_CREATOR_ACCOUNT_ID ?? '';
const ALLOW_RESET = process.env.ALLOW_RESET === '1';

const DEFAULT_AUTHOR = 'Anonymous Witness';
const DEFAULT_LOCATION = 'Unknown';

const DEMO_FACTS = [
  {
    label: 'Aerial drop',
    text: '6:42 PM — A red quadcopter touched down on the City Hall steps; two staffers collected a small metal case.',
    author: 'Elena Park',
    location: 'San Francisco, CA',
    priceUsd: FACT_PRICE_LABEL,
    creatorAddress: DEFAULT_CREATOR_ACCOUNT_ID,
  },
  {
    label: 'Aerial patrol',
    text: '10:18 AM — A remote pilot guided a small aerial craft along the Embarcadero; it hovered briefly above Pier 7 before zipping north.',
    author: 'Maya Chen',
    location: 'Embarcadero, SF',
    priceUsd: FACT_PRICE_LABEL,
    creatorAddress: DEFAULT_CREATOR_ACCOUNT_ID,
  },
  {
    label: 'Weather',
    text: '7:30 AM — Morning fog rolled through Twin Peaks; visibility dropped to a few blocks and drivers slowed noticeably.',
    author: 'Luis Ortega',
    location: 'Twin Peaks, SF',
    priceUsd: FACT_PRICE_LABEL,
    creatorAddress: DEFAULT_CREATOR_ACCOUNT_ID,
  },
  {
    label: 'Market',
    text: '1:05 PM — The Ferry Building farmers market opened with a new pop-up bakery line stretching past the fountain.',
    author: 'Nora Singh',
    location: 'Ferry Building, SF',
    priceUsd: FACT_PRICE_LABEL,
    creatorAddress: DEFAULT_CREATOR_ACCOUNT_ID,
  },
];

// ============================================================================
// HELPERS
// ============================================================================

function buildCitation(fact: FactRecord) {
  return `Eyewitness: ${fact.author}, ${fact.createdAt}, ${fact.location}, Fact ID: ${fact.id}`;
}

function buildCitationMeta(fact: FactRecord) {
  return {
    author: fact.author,
    createdAt: fact.createdAt,
    location: fact.location,
    factId: fact.id,
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');

// ============================================================================
// APP FACTORY
// ============================================================================

export async function createApp() {
  await initFactsStore();

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(publicDir));

  mountPaidRoutes(app, {
    'GET /facts/detail/:id': {
      description: 'NewsFacts paid fact detail',
      mimeType: 'application/json',
      priceHbar: FACT_PRICE_HBAR,
    },
  });

  app.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(
      renderStudioPage({
        factPriceLabel: FACT_PRICE_LABEL,
        defaultCreatorAccountId: DEFAULT_CREATOR_ACCOUNT_ID,
        demoFacts: DEMO_FACTS,
        reownProjectId: REOWN_PROJECT_ID,
        network: hederaConfig.HEDERA_NETWORK,
        photoUploadEnabled: isPinataConfigured(),
      }),
    );
  });

  app.post('/facts', (req, res, next) => {
    if (req.is('multipart/form-data')) {
      photoUpload.array('photos', MAX_PHOTOS)(req, res, (error) => {
        if (error) {
          return res.status(400).json({ error: error.message });
        }
        next();
      });
      return;
    }
    next();
  }, async (req, res) => {
    const text = String(req.body?.text ?? '').trim();
    if (!text) {
      return res.status(400).json({ error: 'Fact text is required.' });
    }

    const author = String(req.body?.author ?? '').trim() || DEFAULT_AUTHOR;
    const location = String(req.body?.location ?? '').trim() || DEFAULT_LOCATION;
    const priceUsd = FACT_PRICE_LABEL;

    const creatorAddress =
      String(req.body?.creatorAddress ?? '').trim() || DEFAULT_CREATOR_ACCOUNT_ID || undefined;

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length && !isPinataConfigured()) {
      return res.status(503).json({ error: 'Photo uploads require PINATA_JWT on the server.' });
    }

    const fact = await addFact({
      text,
      author,
      location,
      priceUsd,
      creatorAddress,
    });

    let photos = fact.photos;
    if (files.length) {
      const uploaded = [];
      for (const file of files) {
        uploaded.push(
          await uploadFactPhoto(file.buffer, file.originalname, file.mimetype, fact.id),
        );
      }
      photos = (await attachPhotosToFact(fact.id, uploaded)) ?? uploaded;
    }

    let hcsAnchor:
      | { topicId: string; transactionId: string; hashscanUrl: string }
      | undefined;
    if (isHcsConfigured()) {
      try {
        const anchor = await anchorFactOnHcs({
          factId: fact.id,
          text: fact.text,
          author: fact.author,
          location: fact.location,
          createdAt: fact.createdAt,
          photoCids: photos.map((photo) => photo.cid),
        });
        await saveHcsAnchor(fact.id, anchor);
        hcsAnchor = {
          topicId: anchor.topicId,
          transactionId: anchor.transactionId,
          hashscanUrl: anchor.hashscanUrl,
        };
      } catch (error) {
        console.warn('HCS anchor failed:', (error as Error).message);
      }
    }

    const citationMeta = buildCitationMeta(fact);
    res.json({
      id: fact.id,
      summary: fact.summary,
      citation: buildCitation(fact),
      citationMeta,
      priceUsd: fact.priceUsd,
      createdAt: fact.createdAt,
      photos,
      photoCount: photos.length,
      hcs: hcsAnchor ?? null,
    });
  });

  if (ALLOW_RESET) {
    app.post('/facts/reset', async (_req, res) => {
      await resetFacts();
      res.json({ ok: true });
    });
  }

  app.get('/facts/search', async (req, res) => {
    const query = String(req.query.q ?? '').trim();
    if (!query) {
      return res.status(400).json({ error: 'Query parameter "q" is required.' });
    }

    const limit = Math.max(1, Math.min(Number(req.query.limit ?? 5), 20));
    const results = await searchFacts(query, limit);

    res.json({
      query,
      count: results.length,
      results: results.map(({ fact, score }) => ({
        id: fact.id,
        summary: fact.summary,
        author: fact.author,
        location: fact.location,
        createdAt: fact.createdAt,
        priceUsd: fact.priceUsd,
        citation: buildCitation(fact),
        citationMeta: buildCitationMeta(fact),
        photoCount: fact.photos.length,
        score: Number(score.toFixed(4)),
      })),
    });
  });

  app.get('/facts/detail/:id', async (req, res) => {
    const fact = await getFactById(req.params.id);
    if (!fact) {
      return res.status(404).json({ error: 'Fact not found.' });
    }

    res.json({
      fact: {
        id: fact.id,
        text: fact.text,
        summary: fact.summary,
        author: fact.author,
        location: fact.location,
        createdAt: fact.createdAt,
        priceUsd: fact.priceUsd,
        creatorAddress: fact.creatorAddress ?? null,
        photos: fact.photos,
        hcs:
          fact.hcsTopicId && fact.hcsTxId
            ? {
                topicId: fact.hcsTopicId,
                transactionId: fact.hcsTxId,
                hashscanUrl: `https://hashscan.io/${hederaConfig.HEDERA_NETWORK === 'hedera:mainnet' ? 'mainnet' : 'testnet'}/transaction/${fact.hcsTxId}`,
              }
            : null,
      },
      citation: buildCitation(fact),
      citationMeta: buildCitationMeta(fact),
      network: hederaConfig.HEDERA_NETWORK,
      seller: SELLER_ACCOUNT_ID,
    });
  });

  app.get('/health', async (_req, res) => {
    res.json({
      status: 'ok',
      seller: SELLER_ACCOUNT_ID,
      network: hederaConfig.HEDERA_NETWORK,
      facilitator: hederaConfig.FACILITATOR_URL,
      facts: await getFactsCount(),
      price: FACT_PRICE_LABEL,
      photos: isPinataConfigured(),
      hcs: isHcsConfigured(),
    });
  });

  return app;
}

// ============================================================================
// START SERVER
// ============================================================================

async function start() {
  const app = await createApp();
  app.listen(PORT, HOST, () => {
    console.log(`
╔════════════════════════════════════════════════════╗
║                 NewsFacts Server                   ║
╚════════════════════════════════════════════════════╝

Server:  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}
Seller:  ${SELLER_ACCOUNT_ID}
Network: ${hederaConfig.HEDERA_NETWORK}
Price:   ${FACT_PRICE_LABEL} per fact detail
Facilitator: ${hederaConfig.FACILITATOR_URL}
Wallet:  ${REOWN_PROJECT_ID ? 'HashPack via Reown' : 'Set REOWN_PROJECT_ID for browser pay'}
Photos:  ${isPinataConfigured() ? 'Pinata IPFS enabled' : 'Set PINATA_JWT for photo uploads'}
HCS:     ${isHcsConfigured() ? 'Fact anchoring enabled' : 'Set HCS operator credentials'}

Endpoints:
  GET  /               - Studio UI (submit + search + pay)
  POST /facts          - Submit a fact (free)
  GET  /facts/search   - Search facts (free)
  GET  /facts/detail/:id - Paid fact detail (x402 Hedera)
  GET  /health         - Health check

Fund testnet HBAR: https://portal.hedera.com
`);
  });
}

const isDirectRun = (() => {
  const current = fileURLToPath(import.meta.url);
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return current === entry;
})();

if (isDirectRun) {
  start().catch((error) => {
    console.error('Failed to start server', error);
    process.exit(1);
  });
}

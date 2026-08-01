export function renderStudioPage(options: {
  factPriceLabel: string;
  defaultCreatorAccountId: string;
  demoFacts: Array<{
    label: string;
    text: string;
    author: string;
    location: string;
    priceUsd: string;
    creatorAddress: string;
  }>;
  reownProjectId: string;
  network: string;
  photoUploadEnabled: boolean;
}) {
  const configJson = JSON.stringify({
    reownProjectId: options.reownProjectId,
    network: options.network,
    price: options.factPriceLabel,
  });
  const demoFactsJson = JSON.stringify(options.demoFacts);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>NewsFacts Studio</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');

      :root {
        --ink: #0e0e13;
        --paper: #f5f0e8;
        --accent: #ff7a00;
        --accent-2: #0b7cff;
        --glass: rgba(255, 255, 255, 0.7);
        --shadow: 0 18px 40px rgba(8, 10, 25, 0.18);
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        font-family: 'Space Grotesk', sans-serif;
        color: var(--ink);
        background: radial-gradient(circle at top, #fff1dc, #f0efe9 48%, #e7ecf4 100%);
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px 16px;
      }

      .shell {
        width: min(960px, 100%);
        background: var(--glass);
        backdrop-filter: blur(10px);
        border-radius: 24px;
        padding: 32px;
        box-shadow: var(--shadow);
        position: relative;
        overflow: hidden;
      }

      .shell::after {
        content: '';
        position: absolute;
        width: 240px;
        height: 240px;
        border-radius: 50%;
        background: rgba(11, 124, 255, 0.15);
        top: -80px;
        right: -60px;
      }

      .shell::before {
        content: '';
        position: absolute;
        width: 220px;
        height: 220px;
        border-radius: 50%;
        background: rgba(255, 122, 0, 0.15);
        bottom: -90px;
        left: -70px;
      }

      header {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 24px;
      }

      h1 { margin: 0; font-size: clamp(2rem, 3vw, 2.8rem); }
      .subtitle { margin: 0; opacity: 0.7; }

      .tabs {
        position: relative;
        z-index: 1;
        display: flex;
        gap: 8px;
        margin-bottom: 20px;
      }

      .tabs button {
        border: none;
        padding: 10px 16px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.8);
        font-weight: 600;
        cursor: pointer;
      }

      .tabs button.active {
        background: linear-gradient(120deg, var(--accent), #ffb500);
        color: white;
      }

      .grid {
        position: relative;
        z-index: 1;
        display: flex;
        justify-content: center;
      }

      [data-panel] { display: none; width: 100%; }
      [data-panel].active { display: block; }

      .card {
        width: 100%;
        max-width: 640px;
        margin: 0 auto;
        background: rgba(255, 255, 255, 0.9);
        border-radius: 18px;
        padding: 20px;
        box-shadow: 0 12px 24px rgba(14, 14, 19, 0.12);
      }

      label {
        font-size: 0.9rem;
        font-weight: 600;
        display: block;
        margin-bottom: 6px;
      }

      textarea, input {
        width: 100%;
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid rgba(14, 14, 19, 0.12);
        font-family: inherit;
        font-size: 0.95rem;
        margin-bottom: 16px;
        background: #fff;
      }

      textarea { min-height: 140px; resize: vertical; }

      .demo-buttons, .wallet-row, .search-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 16px;
      }

      .demo-buttons button, .wallet-btn, .search-btn, .pay-btn {
        border: none;
        padding: 10px 14px;
        border-radius: 12px;
        font-weight: 600;
        cursor: pointer;
      }

      .demo-buttons button {
        background: #f2f6ff;
        color: #0b2b5c;
        font-size: 0.85rem;
      }

      .wallet-btn, .search-btn {
        background: linear-gradient(120deg, var(--accent-2), #4ea8ff);
        color: white;
      }

      .photo-btn {
        width: 100%;
        border: 2px dashed rgba(14, 14, 19, 0.15);
        padding: 12px;
        border-radius: 14px;
        background: #fff;
        color: var(--ink);
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
        margin-bottom: 10px;
        display: block;
        text-align: center;
      }

      .photo-btn.disabled {
        cursor: not-allowed;
        opacity: 0.6;
        background: transparent;
      }

      #photoInput { display: none; }

      .photo-preview {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 16px;
      }

      .photo-preview img {
        width: 88px;
        height: 88px;
        object-fit: cover;
        border-radius: 12px;
        border: 1px solid rgba(14, 14, 19, 0.1);
      }

      .submit-btn {
        width: 100%;
        border: none;
        padding: 14px 18px;
        border-radius: 14px;
        background: linear-gradient(120deg, var(--accent), #ffb500);
        color: white;
        font-size: 1rem;
        font-weight: 700;
        cursor: pointer;
      }

      .note { font-size: 0.82rem; opacity: 0.7; margin-top: 10px; }
      .result, .status {
        margin-top: 14px;
        padding: 12px 14px;
        border-radius: 12px;
        background: #f5f0e8;
        font-size: 0.9rem;
        word-break: break-word;
      }

      .status.error { background: #ffe8e8; color: #8a1f1f; }

      .result-card {
        border: 1px solid rgba(14, 14, 19, 0.08);
        border-radius: 14px;
        padding: 14px;
        margin-bottom: 12px;
        background: #fff;
      }

      .result-meta { font-size: 0.8rem; opacity: 0.7; margin-bottom: 8px; }
      .result-summary { margin-bottom: 12px; line-height: 1.45; }

      .pay-btn {
        background: linear-gradient(120deg, var(--accent), #ffb500);
        color: white;
        width: 100%;
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header>
        <h1>NewsFacts Studio</h1>
        <p class="subtitle">Submit facts for free. Search summaries free. Pay with HashPack on Hedera testnet.</p>
      </header>

      <div class="tabs">
        <button type="button" class="active" data-tab="submit">Submit</button>
        <button type="button" data-tab="search">Search &amp; Pay</button>
      </div>

      <div class="grid">
        <div data-panel="submit" class="active">
          <div class="card">
            <label>Demo facts (one click)</label>
            <div class="demo-buttons" id="demoButtons"></div>
            <form id="factForm">
              <label for="factText">Fact text</label>
              <textarea id="factText" placeholder="What did you witness?"></textarea>
              <label for="photoInput" class="photo-btn ${options.photoUploadEnabled ? '' : 'disabled'}">
                ${options.photoUploadEnabled ? 'Add Photos (up to 3, 5MB each)' : 'Add Photos (set PINATA_JWT on server)'}
              </label>
              <input type="file" id="photoInput" accept="image/*" multiple ${options.photoUploadEnabled ? '' : 'disabled'} />
              <div class="photo-preview" id="photoPreview"></div>
              <label for="author">Author / eyewitness</label>
              <input id="author" placeholder="Name or handle" />
              <label for="location">Location</label>
              <input id="location" placeholder="City, intersection, landmark" />
              <label for="priceUsd">Display price</label>
              <input id="priceUsd" value="${options.factPriceLabel}" readonly />
              <label for="creatorAddress">Creator Hedera account (optional)</label>
              <input id="creatorAddress" placeholder="0.0.xxxxx" value="${options.defaultCreatorAccountId}" />
              <button class="submit-btn" type="submit">Publish Fact</button>
              <div class="note">Payments are fixed at ${options.factPriceLabel} for the demo.</div>
              <div class="result" id="resultBox" hidden></div>
            </form>
          </div>
        </div>

        <div data-panel="search">
          <div class="card">
            <div class="wallet-row">
              <button type="button" class="wallet-btn" id="connectWallet">Connect HashPack</button>
            </div>
            <div class="status" id="walletStatus">Loading HashPack…</div>
            <p class="note">HashPack browser extension required (Chrome/Brave). Site must be HTTPS. Set Testnet in HashPack.</p>

            <label for="searchQuery">Search eyewitness facts</label>
            <div class="search-row">
              <input id="searchQuery" placeholder="e.g. drone, fog, market" style="margin-bottom:0; flex:1" />
              <button type="button" class="search-btn" id="searchBtn">Search</button>
            </div>
            <div id="searchResults"></div>
            <div class="status" id="payStatus"></div>
          </div>
        </div>
      </div>
    </div>

    <script>window.__NF_CONFIG__ = ${configJson};</script>
    <script>window.__NF_DEMO_FACTS__ = ${demoFactsJson};</script>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;
}

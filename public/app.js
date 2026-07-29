import { connectWallet, initWallet, isWalletReady, payForFact } from './wallet-pay.mjs';

const demoFacts = window.__NF_DEMO_FACTS__ ?? [];

function setWalletStatus(message, isError = false) {
  const el = document.getElementById('walletStatus');
  if (!el) return;
  el.textContent = message;
  el.className = isError ? 'status error' : 'status';
}

function setPayStatus(message, isError = false) {
  const el = document.getElementById('payStatus');
  if (!el) return;
  el.textContent = message;
  el.className = isError ? 'status error' : 'status';
}

function initTabs() {
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      document.querySelectorAll('[data-tab]').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('[data-panel]').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.querySelector(`[data-panel="${tab}"]`)?.classList.add('active');
    });
  });
}

function initSubmitForm() {
  const demoButtons = document.getElementById('demoButtons');
  const factText = document.getElementById('factText');
  const author = document.getElementById('author');
  const locationInput = document.getElementById('location');
  const priceUsd = document.getElementById('priceUsd');
  const creatorAddress = document.getElementById('creatorAddress');
  const resultBox = document.getElementById('resultBox');
  const factForm = document.getElementById('factForm');
  const photoInput = document.getElementById('photoInput');
  const photoPreview = document.getElementById('photoPreview');
  let selectedPhotos = [];

  function renderPhotoPreview() {
    if (!photoPreview) return;
    photoPreview.innerHTML = '';
    selectedPhotos.forEach((file, index) => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.alt = file.name;
      img.title = `${file.name} (click to remove)`;
      img.addEventListener('click', () => {
        selectedPhotos = selectedPhotos.filter((_, i) => i !== index);
        renderPhotoPreview();
      });
      photoPreview.appendChild(img);
    });
  }

  photoInput?.addEventListener('change', () => {
    const files = Array.from(photoInput.files ?? []);
    selectedPhotos = files.slice(0, 3);
    if (files.length > 3) {
      resultBox.textContent = 'Only the first 3 photos were kept.';
      resultBox.hidden = false;
    }
    renderPhotoPreview();
  });

  demoFacts.forEach((fact) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = fact.label;
    btn.addEventListener('click', () => {
      factText.value = fact.text;
      author.value = fact.author;
      locationInput.value = fact.location;
      priceUsd.value = fact.priceUsd;
      creatorAddress.value = fact.creatorAddress || '';
    });
    demoButtons.appendChild(btn);
  });

  factForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    resultBox.hidden = true;

    const formData = new FormData();
    formData.set('text', factText.value.trim());
    formData.set('author', author.value.trim());
    formData.set('location', locationInput.value.trim());
    formData.set('creatorAddress', creatorAddress.value.trim());
    selectedPhotos.forEach((file) => formData.append('photos', file));

    const response = await fetch('/facts', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();
    if (!response.ok) {
      resultBox.textContent = data.error ?? 'Failed to create fact.';
      resultBox.hidden = false;
      return;
    }

    const photoNote = data.photoCount ? ` · ${data.photoCount} photo(s) on IPFS` : '';
    resultBox.textContent = `Published! Fact ID: ${data.id}${photoNote}`;
    resultBox.hidden = false;
    selectedPhotos = [];
    if (photoInput) photoInput.value = '';
    renderPhotoPreview();
  });
}

async function searchFacts() {
  const query = document.getElementById('searchQuery').value.trim();
  const resultsEl = document.getElementById('searchResults');
  resultsEl.innerHTML = '';
  if (!query) return;

  setPayStatus('Searching…');
  const res = await fetch(`/facts/search?q=${encodeURIComponent(query)}&limit=5`);
  const data = await res.json();
  if (!res.ok) {
    setPayStatus(data.error ?? 'Search failed', true);
    return;
  }

  setPayStatus('');
  if (!data.results?.length) {
    resultsEl.innerHTML = '<p class="note">No matches.</p>';
    return;
  }

  const price = window.__NF_CONFIG__?.price ?? 'HBAR';
  for (const item of data.results) {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.innerHTML = `
      <div class="result-meta">${item.author} · ${item.location} · score ${item.score}${item.photoCount ? ` · ${item.photoCount} photo(s)` : ''}</div>
      <div class="result-summary">${item.summary}</div>
      <button type="button" class="pay-btn" data-id="${item.id}">Pay ${price} & view full fact</button>
    `;
    card.querySelector('.pay-btn').addEventListener('click', () => handlePay(item.id));
    resultsEl.appendChild(card);
  }
}

async function handlePay(id) {
  if (!isWalletReady()) {
    setPayStatus('Connect HashPack first.', true);
    return;
  }

  setPayStatus('Opening wallet for Hedera x402 payment…');
  try {
    const result = await payForFact(id);
    const hashscan = result.hashscanUrl ? ` — ${result.hashscanUrl}` : '';
    const photoLinks = result.photos?.length
      ? ` Photos: ${result.photos.map((photo) => photo.url).join(', ')}`
      : '';
    setPayStatus(`Paid! ${result.factText}${photoLinks}${hashscan}`);
  } catch (error) {
    setPayStatus(error.message ?? 'Payment failed', true);
  }
}

document.getElementById('connectWallet')?.addEventListener('click', () => {
  try {
    connectWallet();
  } catch (error) {
    setWalletStatus(error.message ?? 'Wallet connect failed', true);
  }
});

document.getElementById('searchBtn')?.addEventListener('click', searchFacts);
document.getElementById('searchQuery')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') searchFacts();
});

initTabs();
initSubmitForm();
initWallet(setWalletStatus);

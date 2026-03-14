import { ethers } from 'ethers';

// ─── Constants ───────────────────────────────────────────────────────────────

const ABSTRACT_RPC = import.meta.env.VITE_ABSTRACT_RPC;
const AGW_FACTORY = '0xe86Bf72715dF28a0b7c3C8F596E7fE05a22A139c';
const KNOWN_TOKENS = [
  { address: '0x84A71ccD554Cc1b02749b35d22F684CC8ec987e1', symbol: 'USDC', decimals: 6 },
  { address: '0x0709F39376dEEe2A2dfC94A58EdEb2Eb9DF012bD', symbol: 'USDT', decimals: 6 },
  { address: '0x3439153EB7AF838Ad19d56E1571FBD09333C2809', symbol: 'WETH', decimals: 18 },
];

// Function selectors (pre-computed keccak256 of signatures)
const SEL_GET_ADDRESS = '0x7603cc86'; // getAddressForSalt(bytes32)
const SEL_BALANCE_OF  = '0x70a08231'; // balanceOf(address)

let results = [];
let scanning = false;
let fundedOnly = false;
let deployedOnly = false;

// ─── Ethers helpers ──────────────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(ABSTRACT_RPC);

function deriveAGWSalt(eoaAddress) {
  const addr = ethers.getAddress(eoaAddress);
  const addrBytes = ethers.getBytes(addr);
  return ethers.keccak256(addrBytes);
}

async function getAGWAddress(salt) {
  const calldata = SEL_GET_ADDRESS + salt.slice(2); // selector + bytes32
  const result = await provider.call({ to: AGW_FACTORY, data: calldata });
  // decode address from 32-byte return
  return ethers.getAddress('0x' + result.slice(26));
}

async function isDeployed(address) {
  const code = await provider.getCode(address);
  return code && code !== '0x' && code.length > 2;
}

async function getETHBalance(address) {
  const bal = await provider.getBalance(address);
  return { raw: bal, formatted: ethers.formatEther(bal) };
}

async function getTokenBalance(tokenAddress, walletAddress, decimals) {
  const paddedAddr = walletAddress.slice(2).padStart(64, '0');
  const calldata = SEL_BALANCE_OF + paddedAddr;
  try {
    const result = await provider.call({ to: tokenAddress, data: calldata });
    const bal = BigInt(result);
    if (bal > 0n) {
      return { raw: bal, formatted: ethers.formatUnits(bal, decimals) };
    }
  } catch {}
  return null;
}

// ─── Scan logic ──────────────────────────────────────────────────────────────

async function scanAddress(eoa) {
  const entry = {
    eoa: ethers.getAddress(eoa),
    agw: null,
    deployed: false,
    ethBalance: '0',
    ethRaw: 0n,
    tokens: [],
    error: null,
  };

  try {
    const salt = deriveAGWSalt(eoa);
    entry.agw = await getAGWAddress(salt);
    entry.deployed = await isDeployed(entry.agw);

    if (entry.deployed) {
      const ethBal = await getETHBalance(entry.agw);
      entry.ethBalance = ethBal.formatted;
      entry.ethRaw = ethBal.raw;

      // Check known tokens
      for (const token of KNOWN_TOKENS) {
        const bal = await getTokenBalance(token.address, entry.agw, token.decimals);
        if (bal) {
          entry.tokens.push({
            symbol: token.symbol,
            address: token.address,
            balance: bal.formatted,
            raw: bal.raw,
          });
        }
      }
    }
  } catch (e) {
    entry.error = e.message || 'Unknown error';
  }

  return entry;
}

// ─── UI Logic ────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

// Count addresses on input
$('addressInput').addEventListener('input', () => {
  const addrs = parseAddresses();
  $('addrCount').textContent = `${addrs.length} address${addrs.length !== 1 ? 'es' : ''}`;
});

function parseAddresses() {
  const raw = $('addressInput').value;
  return raw.split(/[\n,]+/)
    .map(l => l.trim())
    .filter(l => /^0x[a-fA-F0-9]{40}$/.test(l));
}

function toggleFundedOnly() {
  fundedOnly = !fundedOnly;
  $('fundedToggle').classList.toggle('active', fundedOnly);
  renderResults();
}

function toggleDeployedOnly() {
  deployedOnly = !deployedOnly;
  $('deployedToggle').classList.toggle('active', deployedOnly);
  renderResults();
}

async function startScan() {
  if (scanning) return;
  const addresses = parseAddresses();
  if (addresses.length === 0) {
    $('statusText').textContent = 'No valid addresses found. Paste 0x... addresses, one per line.';
    return;
  }

  scanning = true;
  results = [];
  $('scanBtn').disabled = true;
  $('scanBtn').innerHTML = '<div class="spinner"></div> Scanning...';
  $('progressWrap').classList.add('active');
  $('progressBar').style.width = '0%';
  $('emptyState').style.display = 'none';
  $('statsSection').style.display = 'grid';
  $('resultsSection').style.display = 'block';
  $('resultsList').innerHTML = '';

  let done = 0;
  const total = addresses.length;
  const CONCURRENCY = 4;

  // Worker pool
  let idx = 0;
  const workers = [];
  for (let w = 0; w < Math.min(CONCURRENCY, total); w++) {
    workers.push((async () => {
      while (idx < total) {
        const i = idx++;
        $('statusText').textContent = `Scanning ${i + 1} of ${total}...`;
        const result = await scanAddress(addresses[i]);
        results.push(result);
        done++;
        $('progressBar').style.width = `${(done / total) * 100}%`;
        updateStats();
        renderResults();
      }
    })());
  }

  await Promise.all(workers);

  scanning = false;
  $('scanBtn').disabled = false;
  $('scanBtn').innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M7 1v4H3M9 15v-4h4M1 9h4v4M15 7h-4V3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Scan Wallets`;
  $('statusText').textContent = `Done — scanned ${total} wallet${total !== 1 ? 's' : ''} in ${(performance.now() / 1000).toFixed(1)}s`;
  $('progressBar').style.width = '100%';
}

function updateStats() {
  $('statScanned').textContent = results.length;
  $('statDeployed').textContent = results.filter(r => r.deployed).length;
  $('statFunded').textContent = results.filter(r => r.ethRaw > 0n || r.tokens.length > 0).length;
  $('statErrors').textContent = results.filter(r => r.error).length;
}

function renderResults() {
  let filtered = [...results];
  if (fundedOnly) filtered = filtered.filter(r => r.ethRaw > 0n || r.tokens.length > 0);
  if (deployedOnly) filtered = filtered.filter(r => r.deployed);

  // Sort: funded first, then deployed, then rest
  filtered.sort((a, b) => {
    const aFunded = a.ethRaw > 0n || a.tokens.length > 0 ? 2 : a.deployed ? 1 : 0;
    const bFunded = b.ethRaw > 0n || b.tokens.length > 0 ? 2 : b.deployed ? 1 : 0;
    return bFunded - aFunded;
  });

  const list = $('resultsList');
  list.innerHTML = filtered.map((r, i) => {
    const isFunded = r.ethRaw > 0n || r.tokens.length > 0;
    const cardClass = isFunded ? 'funded' : (!r.deployed && !r.error) ? 'empty' : '';
    const shortEoa = r.eoa.slice(0, 8) + '...' + r.eoa.slice(-6);
    const shortAgw = r.agw ? (r.agw.slice(0, 8) + '...' + r.agw.slice(-6)) : '—';
    const agwLink = r.agw ? `https://abscan.org/address/${r.agw}` : '#';
    const ethDisplay = r.deployed && r.ethRaw > 0n
      ? `<span class="badge eth">${parseFloat(r.ethBalance).toFixed(6)} ETH</span>`
      : '';
    const deployBadge = r.error
      ? `<span class="badge error">Error</span>`
      : r.deployed
        ? `<span class="badge deployed">Deployed</span>`
        : `<span class="badge not-deployed">Not Deployed</span>`;

    const tokenHtml = r.tokens.length > 0
      ? `<div class="result-tokens">${r.tokens.map(t =>
          `<div class="token-badge"><span class="token-symbol">${t.symbol}</span><span class="token-amount">${formatTokenBalance(t.balance, t.symbol)}</span></div>`
        ).join('')}</div>`
      : '';

    return `
      <div class="result-card ${cardClass} fade-in" style="animation-delay: ${i * 30}ms">
        <div class="result-main">
          <div class="result-addresses">
            <div class="result-eoa"><span class="label">EOA</span>${shortEoa}</div>
            <div class="result-agw"><span class="label">AGW</span><a href="${agwLink}" target="_blank" rel="noopener" title="${r.agw || ''}">${shortAgw}</a></div>
          </div>
          <div class="result-badges">${ethDisplay}${deployBadge}</div>
        </div>
        ${tokenHtml}
      </div>
    `;
  }).join('');

  if (filtered.length === 0 && results.length > 0) {
    list.innerHTML = '<div class="empty-state"><p>No results match your filters</p></div>';
  }
}

function formatTokenBalance(balance, symbol) {
  const num = parseFloat(balance);
  if (num === 0) return '0';
  if (num < 0.001) return '<0.001';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
  return num.toFixed(symbol === 'WETH' ? 6 : 2);
}

function exportJSON() {
  const exportData = results.map(r => ({
    eoa: r.eoa,
    agw: r.agw,
    deployed: r.deployed,
    ethBalance: r.ethBalance,
    tokens: r.tokens.map(t => ({ symbol: t.symbol, balance: t.balance, contract: t.address })),
    error: r.error,
  }));
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'agw-scan-results.json'; a.click();
  URL.revokeObjectURL(url);
}

// Expose functions to HTML onclick handlers
window.startScan = startScan;
window.toggleFundedOnly = toggleFundedOnly;
window.toggleDeployedOnly = toggleDeployedOnly;
window.exportJSON = exportJSON;

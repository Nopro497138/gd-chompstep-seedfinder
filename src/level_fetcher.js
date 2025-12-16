// src/level_fetcher.js
// Robust fetch of level data using multiple endpoints with timeouts, retries, and size limits.

const zlib = require('zlib');

/**
 * tryDecodeLevelString(rawText)
 * - tries to parse JSON to extract levelString
 * - attempts base64 decode + zlib inflateRaw/inflate
 * - enforces size limits to avoid large allocations
 */
function tryDecodeLevelString(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const candidate = rawText.trim();

  // If it's JSON with a "levelString" or similar field, extract that first
  try {
    const parsed = JSON.parse(candidate);
    const maybe = parsed.levelString || parsed.levelstring || parsed.level_string || parsed.level || parsed.data;
    if (typeof maybe === 'string' && maybe.length > 10) {
      return tryDecodeLevelString(maybe);
    }
  } catch (e) {
    // not JSON — continue
  }

  // Quick sanity: if the string is extremely long, reject to avoid OOM
  const MAX_RAW_LEN = 5_000_000; // 5 MB raw limit
  if (candidate.length > MAX_RAW_LEN) {
    // too big to safely decode
    return null;
  }

  // Try base64 decode (URL-safe replacement)
  try {
    const norm = candidate.replace(/-/g, '+').replace(/_/g, '/');
    const buf = Buffer.from(norm, 'base64');
    if (!buf || buf.length === 0 || buf.length > MAX_RAW_LEN) return null;

    // Try inflateRaw then inflate; if both fail, see if the base64-decoded text looks like level data
    try {
      const dec = zlib.inflateRawSync(buf);
      const txt = dec.toString('utf8');
      if (txt && txt.length > 0) return txt;
    } catch (e1) {
      try {
        const dec2 = zlib.inflateSync(buf);
        const txt2 = dec2.toString('utf8');
        if (txt2 && txt2.length > 0) return txt2;
      } catch (e2) {
        // maybe it's plain text
        const text = buf.toString('utf8');
        if (text && text.length > 0 && text.match(/[|,;:]/)) return text;
        return null;
      }
    }
  } catch (err) {
    return null;
  }
}

/**
 * fetchWithTimeout(url, options, timeoutMs)
 * - uses global fetch with AbortController
 * - returns text or throws
 */
async function fetchWithTimeout(url, { timeoutMs = 5000, retries = 1 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      clearTimeout(id);
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} (${url}) — response len ${t ? t.length : 0}`);
      }
      // Limit the amount of text we read to avoid huge allocations
      // If content-length header exists and is too big, bail early
      const cl = res.headers.get('content-length');
      if (cl && Number(cl) > 5_000_000) {
        throw new Error(`Content-Length too large: ${cl}`);
      }
      // read text but cap length by slicing if needed
      const txt = await res.text();
      if (txt.length > 5_000_000) {
        throw new Error(`Response too large (${txt.length} bytes)`);
      }
      return txt;
    } catch (err) {
      clearTimeout(id);
      if (attempt === retries) throw err;
      // else retry after small delay
      await new Promise(r => setTimeout(r, 300 * attempt));
    }
  }
  throw new Error('unreachable');
}

/**
 * fetchAndDecodeLevel(levelId)
 * - tries multiple endpoints and returns { id, raw, decoded }
 */
async function fetchAndDecodeLevel(levelId) {
  // Candidate endpoints. gdbrowser endpoints are primary; we include some variations.
  const endpoints = [
    `https://gdbrowser.com/api/download/${levelId}`,
    `https://gdbrowser.com/api/level/${levelId}`,
    `https://gdbrowser.com/api/getGJLevelWithUserCredits.php?levelID=${levelId}`,
    `https://api.gdbrowser.com/download/${levelId}`,
    `https://gdbrowser.com/api/search/${levelId}` // fallback attempt
  ];

  let lastRaw = null;
  for (const url of endpoints) {
    try {
      console.log(`Trying endpoint: ${url}`);
      const text = await fetchWithTimeout(url, { timeoutMs: 7000, retries: 2 });
      if (!text || text.length === 0) {
        console.log(`Endpoint ${url} returned empty response`);
        lastRaw = text || lastRaw;
        continue;
      }
      lastRaw = text;
      // Attempt decode
      const decoded = tryDecodeLevelString(text);
      if (decoded) {
        console.log(`Successfully decoded level data from ${url}`);
        return { id: levelId, raw: text, decoded };
      } else {
        console.log(`Could not decode payload from ${url} — returning raw`);
        // still return raw so caller can store it for analysis
        return { id: levelId, raw: text, decoded: null };
      }
    } catch (err) {
      console.log(`Endpoint ${url} failed: ${err && err.message ? err.message : err}`);
      // continue to next endpoint
    }
  }

  return { id: levelId, raw: lastRaw || '', decoded: null };
}

module.exports = {
  fetchAndDecodeLevel
};

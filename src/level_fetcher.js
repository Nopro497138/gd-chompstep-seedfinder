// src/level_fetcher.js
// Fetches level data given a level ID using GDBrowser endpoints and attempts to decode the levelstring.
// Returns: { id, raw, decoded } where decoded may be null if decoding fails.

const zlib = require('zlib');

/**
 * tryDecodeLevelString(rawText)
 * - tries to base64-decode rawText, then zlib inflateRaw or inflate
 * - returns decoded string on success or null on failure
 */
function tryDecodeLevelString(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  // Some endpoints may already return JSON; we try to extract obvious base64 substrings
  const candidate = rawText.trim();

  // If it looks like JSON, maybe there's a field "levelString": "..."
  try {
    const parsed = JSON.parse(candidate);
    // common fields: levelString, levelstring, level_string
    const maybe = parsed.levelString || parsed.levelstring || parsed.level_string || parsed.level;
    if (typeof maybe === 'string' && maybe.length > 10) {
      return tryDecodeLevelString(maybe);
    }
  } catch (e) {
    // not JSON — continue
  }

  // Try raw base64 decode
  try {
    // Some levelstrings use URL-safe base64 (replace -_ with +/)
    const norm = candidate.replace(/-/g, '+').replace(/_/g, '/');
    const buf = Buffer.from(norm, 'base64');
    if (!buf || buf.length === 0) return null;

    // Try inflateRaw then inflate (some servers produce raw deflate, some wrapped)
    try {
      const dec = zlib.inflateRawSync(buf);
      return dec.toString('utf8');
    } catch (e1) {
      try {
        const dec2 = zlib.inflateSync(buf);
        return dec2.toString('utf8');
      } catch (e2) {
        // not zlib-compressed — maybe plain text encoded in base64
        const text = buf.toString('utf8');
        if (text && text.length > 0 && text.match(/[|,;:]/)) {
          return text;
        }
        return null;
      }
    }
  } catch (err) {
    return null;
  }
}

/**
 * fetchAndDecodeLevel(levelId)
 * - tries multiple endpoints from GDBrowser to fetch data
 * - returns { id, raw, decoded } (decoded may be null)
 */
async function fetchAndDecodeLevel(levelId) {
  const endpoints = [
    `https://gdbrowser.com/api/download/${levelId}`,
    `https://gdbrowser.com/api/level/${levelId}`,
    `https://gdbrowser.com/api/getGJLevelWithUserCredits.php?levelID=${levelId}`
  ];

  let lastRaw = null;
  for (const url of endpoints) {
    try {
      console.log(`Trying ${url} ...`);
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        console.log(`  Endpoint ${url} returned HTTP ${res.status}`);
        const text = await res.text().catch(()=>null);
        if (text) lastRaw = text;
        continue;
      }
      const text = await res.text();
      lastRaw = text;
      // quick sanity
      if (text && text.length > 0) {
        // attempt decode
        const decoded = tryDecodeLevelString(text);
        return { id: levelId, raw: text, decoded };
      }
    } catch (err) {
      console.log(`  Request to ${url} failed: ${err.message}`);
      // continue to next endpoint
    }
  }

  // if we reached here, return last raw response (maybe empty) and no decoded content
  return { id: levelId, raw: lastRaw || '', decoded: null };
}

module.exports = {
  fetchAndDecodeLevel
};

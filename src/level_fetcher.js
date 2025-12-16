// src/level_fetcher.js
// Fetch & decode level data. Strategy:
// 1) Try gj-boomlings-api.dlLevel(id)
// 2) If that yields a levelString or raw payload, try gdparse.parseLevel(levelString)
// 3) If not, fallback to robust HTTP endpoints (gdbrowser / boomlings) with timeouts/retries
//
// Returns: { id, raw, decoded } where decoded is either the parsed object from gdparse.parseLevel()
// or null if decoding not possible.

const zlib = require('zlib');
const gdparse = require('gdparse'); // parseLevel, decodeGameSave etc.
let gjApi = null;
try {
  gjApi = require('gj-boomlings-api');
} catch (e) {
  gjApi = null;
}

const MAX_RAW_LEN = 5_000_000; // 5 MB

async function tryGjApi(levelId) {
  if (!gjApi) return null;
  try {
    // dlLevel returns various shapes depending on implementation; commonly returns decoded object or raw string
    const res = await gjApi.dlLevel(String(levelId));
    // Try to find levelString or similar fields
    if (!res) return null;
    // res might be string (raw) or object
    if (typeof res === 'string') {
      return { raw: res, source: 'gj-boomlings-api' };
    }
    // common field names: levelString, levelstring, level
    const maybe = res.levelString || res.levelstring || res.level || res.data || res;
    // If maybe is object that already contains parsed info (some wrappers parse automatically)
    if (typeof maybe === 'object' && Object.keys(maybe).length > 0) {
      return { raw: JSON.stringify(maybe), decoded: maybe, source: 'gj-boomlings-api' };
    }
    if (typeof maybe === 'string' && maybe.length > 0) {
      return { raw: maybe, source: 'gj-boomlings-api' };
    }
    // fallback: stringify entire response
    return { raw: JSON.stringify(res), source: 'gj-boomlings-api' };
  } catch (err) {
    console.log('gj-boomlings-api request failed:', err && err.message ? err.message : err);
    return null;
  }
}

function tryParseWithGdparse(payload) {
  try {
    // gdparse exposes parseLevel (accepts levelString) and decodeGameSave for saves
    const parsed = gdparse.parseLevel(payload);
    return parsed;
  } catch (err) {
    // gdparse may throw if payload not actually a levelString yet (e.g. raw server response)
    return null;
  }
}

// minimal base64/zlib/xor decode helper in case the payload is still encoded
function tryBasicDecode(candidate) {
  if (!candidate || typeof candidate !== 'string') return null;

  // quick safety
  if (candidate.length > MAX_RAW_LEN) return null;

  // sometimes the server returns JSON with a 'levelString' field inside -> try to parse
  try {
    const p = JSON.parse(candidate);
    const maybe = p.levelString || p.levelstring || p.level || p.data;
    if (typeof maybe === 'string') {
      return maybe;
    }
  } catch (e) {
    // not JSON — continue
  }

  // Many server-side responses are already the encoded levelString: perform basic normalization
  // Replace URL-safe to standard base64
  const norm = candidate.replace(/-/g, '+').replace(/_/g, '/');

  // Try base64 decode -> then attempt zlib inflateRaw/inflate and finally return text if plausible
  try {
    const buf = Buffer.from(norm, 'base64');
    if (!buf || buf.length === 0 || buf.length > MAX_RAW_LEN) return null;

    // try inflateRaw
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
        // fallback plain text
        const text = buf.toString('utf8');
        if (text && text.length > 0) return text;
      }
    }
  } catch (e) {
    return null;
  }
  return null;
}

// HTTP fallback (robust): tries several endpoints with timeouts
async function fetchWithTimeout(url, { timeoutMs = 6000, retries = 2 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      clearTimeout(id);
      if (!res.ok) {
        const txt = await res.text().catch(()=>'');
        throw new Error(`HTTP ${res.status} (${url}) len ${txt.length}`);
      }
      const cl = res.headers.get('content-length');
      if (cl && Number(cl) > MAX_RAW_LEN) throw new Error(`Content too large: ${cl}`);
      const txt = await res.text();
      if (txt.length > MAX_RAW_LEN) throw new Error(`Response too large (${txt.length})`);
      return txt;
    } catch (err) {
      clearTimeout(id);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 300 * attempt));
    }
  }
  throw new Error('unreachable');
}

async function tryHttpFallback(levelId) {
  const endpoints = [
    `https://gdbrowser.com/api/download/${levelId}`,
    `https://gdbrowser.com/api/level/${levelId}`,
    `https://gdbrowser.com/api/getGJLevelWithUserCredits.php?levelID=${levelId}`,
    `https://boomlings.com/database/downloadGJLevel22.php?levelID=${levelId}`, // sometimes GET works for proxies
  ];

  let lastRaw = '';
  for (const url of endpoints) {
    try {
      const txt = await fetchWithTimeout(url, { timeoutMs: 7000, retries: 2 });
      lastRaw = txt || lastRaw;
      // try to pull something sensible out
      if (txt && txt.length > 0) {
        // some endpoints return JSON-ish objects; some return directly an encoded levelString
        // try to find a base64-like substring or direct field
        // first try gdparse.parseLevel directly (it can accept decoded-levelstrings)
        const parsedDirect = tryParseWithGdparse(txt);
        if (parsedDirect) return { raw: txt, decoded: parsedDirect, source: url };

        // try basic decode then parse
        const maybe = tryBasicDecode(txt);
        if (maybe) {
          const parsed2 = tryParseWithGdparse(maybe);
          if (parsed2) return { raw: txt, decoded: parsed2, source: url };
          // otherwise, return the decoded text for manual inspection
          return { raw: txt, decoded: null, source: url };
        }
      }
    } catch (err) {
      // continue to next endpoint
      lastRaw = lastRaw || (err && err.message ? err.message : String(err));
      continue;
    }
  }
  return { raw: lastRaw || '', decoded: null, source: 'fallback' };
}

/**
 * fetchAndDecodeLevel(levelId)
 * Main export. Tries:
 * 1) gj-boomlings-api (preferred)
 * 2) gdparse.parseLevel if we have a levelString
 * 3) HTTP fallbacks
 *
 * Returns { id, raw, decoded, source }
 */
async function fetchAndDecodeLevel(levelId) {
  // 1) try API wrapper
  const fromApi = await tryGjApi(levelId);
  if (fromApi) {
    // if API returned decoded object already, return it
    if (fromApi.decoded) return { id: levelId, raw: fromApi.raw || '', decoded: fromApi.decoded, source: fromApi.source || 'gj-api' };
    // else try to decode raw with gdparse
    if (fromApi.raw) {
      const basic = tryBasicDecode(fromApi.raw);
      if (basic) {
        const parsed = tryParseWithGdparse(basic);
        if (parsed) return { id: levelId, raw: fromApi.raw, decoded: parsed, source: fromApi.source || 'gj-api' };
        // if not parsed, return raw for inspection
        return { id: levelId, raw: fromApi.raw, decoded: null, source: fromApi.source || 'gj-api' };
      } else {
        // maybe API returned JSON object stringified
        try {
          const js = JSON.parse(fromApi.raw);
          // If js contains a field 'levelString', attempt decode
          const candidate = js.levelString || js.levelstring || js.level;
          if (candidate) {
            const decodedCandidate = tryBasicDecode(candidate);
            if (decodedCandidate) {
              const parsed = tryParseWithGdparse(decodedCandidate);
              if (parsed) return { id: levelId, raw: fromApi.raw, decoded: parsed, source: fromApi.source || 'gj-api' };
            }
          }
        } catch (e) {
          // ignore parse errors
        }
      }
    }
  }

  // 2) HTTP fallback attempts
  const fallback = await tryHttpFallback(levelId);
  return { id: levelId, raw: fallback.raw || '', decoded: fallback.decoded || null, source: fallback.source || 'fallback' };
}

module.exports = {
  fetchAndDecodeLevel
};

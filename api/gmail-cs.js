/**
 * /api/gmail-cs — Gmail integration untuk CS Input
 *
 * Routing:
 *   GET  ?action=url&cs_id=xxx        → generate Google OAuth URL
 *   GET  ?action=status&cs_id=xxx     → cek status koneksi Gmail
 *   GET  ?action=disconnect&cs_id=xxx → putus koneksi Gmail
 *   GET  ?code=xxx&state=xxx          → OAuth callback dari Google
 *   POST header x-cron-secret         → gmail poller (cron tiap 5 menit)
 */

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const CRON_SECRET          = process.env.CRON_SECRET;
const APP_URL              = 'https://adsycsorder.vercel.app';
const REDIRECT_URI         = `${APP_URL}/api/gmail-cs`;

const SCOPE = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

// ── Supabase helpers ──────────────────────────────────────
const sbH = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_SERVICE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Prefer': 'return=representation',
};
async function sbGet(table, query = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, { headers: sbH });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function sbPost(table, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...sbH, 'Prefer': 'return=representation,resolution=ignore-duplicates' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function sbPatch(table, query, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method: 'PATCH',
    headers: { ...sbH, 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
}

// ── Google OAuth helpers ──────────────────────────────────
async function getAccessToken(refreshToken) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const d = await r.json();
  if (d.error) throw new Error(`Token error: ${d.error} — ${d.error_description}`);
  return d.access_token;
}

// ── Gmail API helpers ─────────────────────────────────────
async function searchEmails(accessToken) {
  const q = encodeURIComponent('(from:support@orderonline.id OR from:no-reply@loops.id) newer_than:7d');
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=50`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const d = await r.json();
  if (d.error) {
    const err = new Error(`Gmail API error: ${d.error.code} — ${d.error.message}`);
    err.gmailCode = d.error.code;
    throw err;
  }
  return d.messages || [];
}
async function getEmail(accessToken, id) {
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return r.json();
}
async function markAsRead(accessToken, id) {
  await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
  });
}
function decodeBase64(data) {
  if (!data) return '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}
function extractBody(payload) {
  if (!payload) return '';
  if (payload.body?.data) return decodeBase64(payload.body.data);
  if (payload.parts) {
    const html = payload.parts.find(p => p.mimeType === 'text/html');
    if (html?.body?.data) return decodeBase64(html.body.data);
    const txt = payload.parts.find(p => p.mimeType === 'text/plain');
    if (txt?.body?.data) return decodeBase64(txt.body.data);
    for (const p of payload.parts) { const b = extractBody(p); if (b) return b; }
  }
  return '';
}

// ── Parse email orderonline.id → ambil HP + nama + produk ─
function parseOrderonlineEmail(body) {
  const namaMatch = body.match(/Nama[^:]*:\s*<\/?(b|strong|td)[^>]*>\s*([^<\n]+)/i)
                 || body.match(/Nama[^:]*:\s*([^\n<]+)/i);
  const hpMatch   = body.match(/No\.?\s*Telepon[^:]*:\s*<\/?(b|strong|td)[^>]*>\s*([+\d\s]+)/i)
                 || body.match(/No\.?\s*(?:Telepon|HP)[^:]*:\s*([+\d][\d\s\-]{7,})/i);
  const produkMatch = body.match(/<td[^>]*>\s*([A-Za-z][^<]{3,80}?)\s*<\/td>\s*(?:<[^>]+>)*\s*Rp/i)
                   || body.match(/([A-Za-z][^\n<]{3,60}?)\s+Rp[\d.,]+/i);
  return {
    nama:   (namaMatch?.[namaMatch.length - 1]   || '').trim(),
    hp:     (hpMatch?.[hpMatch.length - 1]       || '').replace(/[\s\-]/g, '').trim(),
    produk: (produkMatch?.[1]                    || '').trim(),
  };
}

// ── Parse email loops.id → "• Nama: X", "• No HP: X", "• Produk: X" ─
function parseLoopsEmail(body) {
  const namaMatch  = body.match(/Nama\s*:\s*([^\n<•]+)/i);
  const hpMatch    = body.match(/No\s*HP\s*:\s*([\d+][\d\s\-]{7,})/i);
  const produkMatch= body.match(/Produk\s*:\s*([^\n<•]+)/i);
  return {
    nama:   (namaMatch?.[1]  || '').trim(),
    hp:     (hpMatch?.[1]    || '').replace(/[\s\-]/g, '').trim(),
    produk: (produkMatch?.[1]|| '').trim(),
  };
}

function parseOrderEmail(body, fromHeader) {
  if (fromHeader && fromHeader.includes('loops.id')) return parseLoopsEmail(body);
  return parseOrderonlineEmail(body);
}

// Normalisasi HP → format 08xxx
function normalizeHP(hp) {
  let n = (hp || '').replace(/\D/g, '');
  if (n.startsWith('62')) n = '0' + n.slice(2);
  if (n.startsWith('8'))  n = '0' + n;
  return n;
}

// ═══════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-cron-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, cs_id, code, state, error } = req.query;

  // ── GET routes ────────────────────────────────────────────
  if (req.method === 'GET') {

    // Generate OAuth URL
    if (action === 'url') {
      if (!cs_id) return res.status(400).json({ error: 'cs_id wajib' });
      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        state: cs_id,
      });
      return res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
    }

    // Cek status koneksi Gmail
    if (action === 'status') {
      if (!cs_id) return res.status(400).json({ error: 'cs_id wajib' });
      const rows = await sbGet('cs_profiles', `?id=eq.${cs_id}&select=gmail_email,gmail_last_checked&limit=1`);
      const row  = rows[0] || {};
      return res.json({
        connected: !!row.gmail_email,
        gmail_email: row.gmail_email || null,
        gmail_last_checked: row.gmail_last_checked || null,
      });
    }

    // Putus koneksi Gmail
    if (action === 'disconnect') {
      if (!cs_id) return res.status(400).json({ error: 'cs_id wajib' });
      await sbPatch('cs_profiles', `?id=eq.${cs_id}`,
        { gmail_email: null, gmail_refresh_token: null, gmail_last_checked: null });
      return res.json({ ok: true });
    }

    // OAuth callback dari Google
    if (error) return res.redirect(`${APP_URL}/app.html?gmail=cancelled`);

    if (code && state) {
      try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uri: REDIRECT_URI,
            grant_type: 'authorization_code',
          }),
        });
        const tokens = await tokenRes.json();
        if (tokens.error) {
          return res.redirect(`${APP_URL}/app.html?gmail=error&reason=${tokens.error}`);
        }

        const uiRes  = await fetch('https://www.googleapis.com/oauth2/v2/userinfo',
          { headers: { Authorization: `Bearer ${tokens.access_token}` } });
        const uiData = await uiRes.json();

        // state = cs_id
        await sbPatch('cs_profiles', `?id=eq.${state}`, {
          gmail_email: uiData.email || null,
          gmail_refresh_token: tokens.refresh_token,
          gmail_last_checked: null,
        });

        return res.redirect(`${APP_URL}/app.html?gmail=success&email=${encodeURIComponent(uiData.email || '')}`);
      } catch(e) {
        console.error('[gmail-cs] OAuth callback error:', e);
        return res.redirect(`${APP_URL}/app.html?gmail=error&reason=server`);
      }
    }

    return res.status(400).json({ error: 'Invalid GET request' });
  }

  // ── POST: Cron poller ─────────────────────────────────────
  if (req.method === 'POST') {
    const cronSecret = req.headers['x-cron-secret'];
    if (cronSecret !== CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const start      = Date.now();
    const BUDGET_MS  = 8000; // bail out 2s sebelum limit 10s (Hobby plan)
    const CONCUR     = 5;    // max paralel fetch email per CS
    const results    = [];

    const timeLeft = () => BUDGET_MS - (Date.now() - start);

    // Ambil CS sorted by gmail_last_checked ASC (yang paling lama/belum pernah dicek duluan)
    // Rotating queue: tiap run proses sebanyak yang muat dalam time budget
    const csProfiles = await sbGet('cs_profiles',
      `?gmail_refresh_token=not.is.null&select=id,nama,gmail_email,gmail_refresh_token,gmail_last_checked&order=gmail_last_checked.asc.nullsfirst`);

    if (!csProfiles.length) {
      return res.json({ ok: true, message: 'Tidak ada Gmail CS terhubung' });
    }

    for (const cs of csProfiles) {
      // Bail out kalau waktu sudah mepet
      if (timeLeft() < 3000) {
        results.push({ cs_id: cs.id, cs_nama: cs.nama, skipped: true, reason: 'budget habis' });
        continue;
      }

      const log = { cs_id: cs.id, cs_nama: cs.nama, gmail: cs.gmail_email, saved: 0, errors: [] };
      try {
        const token    = await getAccessToken(cs.gmail_refresh_token);
        const allMessages = await searchEmails(token);
        log.emails_found = allMessages.length;
        if (!allMessages.length) {
          await sbPatch('cs_profiles', `?id=eq.${cs.id}`, { gmail_last_checked: new Date().toISOString() });
          results.push(log);
          continue;
        }

        // Cek mana message ID yang sudah tersimpan di gmail_leads → skip fetch body-nya
        const allIds = allMessages.map(m => m.id);
        const existingRows = await sbGet('gmail_leads',
          `?cs_id=eq.${cs.id}&gmail_msg_id=in.(${allIds.join(',')})&select=gmail_msg_id`
        ).catch(() => []);
        const existingIds = new Set((existingRows || []).map(r => r.gmail_msg_id));
        const messages = allMessages.filter(m => !existingIds.has(m.id));
        log.emails_new = messages.length;
        log.emails_skip = allIds.length - messages.length;

        if (!messages.length) {
          await sbPatch('cs_profiles', `?id=eq.${cs.id}`, { gmail_last_checked: new Date().toISOString() });
          results.push(log);
          continue;
        }

        const processedThreads = new Set();

        // Proses email secara paralel (batch CONCUR sekaligus)
        async function processMsg(msg) {
          try {
            const email    = await getEmail(token, msg.id);
            const threadId = email.threadId || msg.id;

            if (processedThreads.has(threadId)) return;
            processedThreads.add(threadId);

            const emailBody = extractBody(email.payload);
            if (!emailBody) return;

            const fromHeader = email.payload?.headers?.find(h => h.name === 'From')?.value || '';
            const orderData  = parseOrderEmail(emailBody, fromHeader);
            if (!orderData.hp) return;

            const hp        = normalizeHP(orderData.hp);
            const sentDate  = email.payload?.headers?.find(h => h.name === 'Date')?.value;
            const emailDate = sentDate ? new Date(sentDate).toISOString() : new Date().toISOString();

            await sbPost('gmail_leads', {
              cs_id:        cs.id,
              cs_nama:      cs.nama,
              gmail_msg_id: msg.id,
              hp,
              nama:         orderData.nama  || null,
              produk:       orderData.produk || null,
              email_date:   emailDate,
            }).catch(e => {
              if (!e.message.includes('duplicate')) throw e;
            });

            log.saved++;
          } catch(e) {
            log.errors.push({ msg_id: msg.id, error: e.message });
          }
        }

        // Batch paralel dengan concurrency limit CONCUR
        for (let i = 0; i < messages.length; i += CONCUR) {
          if (timeLeft() < 3000) { log.partial = true; break; }
          const batch = messages.slice(i, i + CONCUR);
          await Promise.all(batch.map(processMsg));
        }

        await sbPatch('cs_profiles', `?id=eq.${cs.id}`,
          { gmail_last_checked: new Date().toISOString() });

      } catch(e) {
        log.errors.push({ error: e.message });
        // Kalau 403 (scope kurang) → hapus refresh token supaya CS tahu perlu reconnect
        if (e.gmailCode === 403) {
          await sbPatch('cs_profiles', `?id=eq.${cs.id}`, { gmail_refresh_token: null }).catch(() => {});
        }
      }
      results.push(log);
    }

    const skipped = results.filter(r => r.skipped).length;
    const processed = results.filter(r => !r.skipped).length;
    return res.json({ ok: true, duration_ms: Date.now() - start, processed, skipped, results });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

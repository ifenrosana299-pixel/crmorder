// Hapus bukti screenshot (bucket ss-bukti) yang udah lebih dari RETENTION_DAYS hari, biar storage
// gak penuh. ss-bukti ada di project Supabase TERPISAH dari database utama (lihat js/auth.js
// SS_SUPABASE_URL) -- jadi butuh service role key sendiri (SS_SUPABASE_SERVICE_KEY), beda dari
// SUPABASE_SERVICE_KEY yang dipakai buat orderan_masuk_crm/all_orderan.
const RETENTION_DAYS = 7;
const ROWS_PER_RUN = 300; // batasi per invocation biar tidak kena timeout serverless

module.exports = async function handler(req, res) {
  const secret = req.query.secret || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const SUPABASE_URL     = process.env.SUPABASE_URL;
  const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY;
  const SS_SUPABASE_URL  = process.env.SS_SUPABASE_URL;
  const SS_SUPABASE_KEY  = process.env.SS_SUPABASE_SERVICE_KEY;

  if (!SS_SUPABASE_URL || !SS_SUPABASE_KEY) {
    res.status(500).json({ error: 'SS_SUPABASE_URL / SS_SUPABASE_SERVICE_KEY belum di-set di env Vercel' });
    return;
  }

  const sbHeaders = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };
  const ssHeaders = {
    apikey: SS_SUPABASE_KEY,
    Authorization: `Bearer ${SS_SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };

  // Mode dry-run buat testing aman: ?dry=1 atau header X-Dry-Run -- kelar sampe tahap "nemu apa
  // yang MESTINYA kehapus", tapi skip request DELETE ke storage & PATCH ke orderan_masuk_crm.
  const isDry = req.query.dry === '1' || req.headers['x-dry-run'] === '1';

  let ordersChecked = 0, filesDeleted = 0, ordersCleared = 0, errors = 0;

  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 864e5);
    const cutoffStr = cutoff.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

    // Ambil order lama yang masih punya bukti (ss_urls jsonb array, belum null)
    const filter = new URLSearchParams({
      select: 'id,ss_urls',
      tanggal: `lt.${cutoffStr}`,
      ss_urls: 'not.is.null',
      order: 'id',
      limit: String(ROWS_PER_RUN)
    });
    const listRes = await fetch(`${SUPABASE_URL}/rest/v1/orderan_masuk_crm?${filter.toString()}`, { headers: sbHeaders });
    const rows = await listRes.json();
    if (!Array.isArray(rows)) throw new Error('Gagal ambil data orderan_masuk_crm: ' + JSON.stringify(rows));

    const targets = rows.filter(r => Array.isArray(r.ss_urls) && r.ss_urls.length > 0);
    ordersChecked = targets.length;

    // Path storage = semua yang setelah "/ss-bukti/" di public URL (lihat ssSave() di js/app.js,
    // path diisi `${orderId}/${type}_${timestamp}.jpg`)
    const allPaths = [];
    targets.forEach(r => {
      r.ss_urls.forEach(s => {
        const m = /\/ss-bukti\/(.+)$/.exec(s.url || '');
        if (m) allPaths.push(decodeURIComponent(m[1]));
      });
    });

    if (allPaths.length && !isDry) {
      // Storage remove batasin per 100 path per request biar body gak kegedean
      for (let i = 0; i < allPaths.length; i += 100) {
        const batch = allPaths.slice(i, i + 100);
        const delRes = await fetch(`${SS_SUPABASE_URL}/storage/v1/object/ss-bukti`, {
          method: 'DELETE',
          headers: ssHeaders,
          body: JSON.stringify({ prefixes: batch })
        });
        if (delRes.ok) filesDeleted += batch.length;
        else errors++;
      }
    } else if (isDry) {
      filesDeleted = allPaths.length; // simulasi, gak beneran ke-hit request DELETE-nya
    }

    // Kosongin ss_urls di orderan_masuk_crm supaya gak dicoba hapus lagi run berikutnya + tombol
    // "Lihat Bukti" otomatis balik ke "—"/"Upload Bukti" (order udah lewat retensi)
    if (targets.length && !isDry) {
      const ids = targets.map(r => r.id);
      const clearRes = await fetch(`${SUPABASE_URL}/rest/v1/orderan_masuk_crm?id=in.(${ids.join(',')})`, {
        method: 'PATCH',
        headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ ss_urls: null })
      });
      if (clearRes.ok) ordersCleared = ids.length;
      else errors++;
    } else if (isDry) {
      ordersCleared = targets.length; // simulasi
    }

    res.status(200).json({
      dryRun: isDry,
      ordersChecked, filesDeleted, ordersCleared, errors, cutoff: cutoffStr,
      sampleOrderIds: isDry ? targets.slice(0, 10).map(r => r.id) : undefined
    });
  } catch (e) {
    res.status(500).json({ error: e.message, ordersChecked, filesDeleted, ordersCleared, errors });
  }
};

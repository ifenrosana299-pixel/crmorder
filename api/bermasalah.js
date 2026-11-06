// GET  /api/bermasalah        — Ambil semua resi BERMASALAH dari cs_order_tracking_crm + room_work (CRM Tracking)
// POST /api/bermasalah        — Update room_work di CRM Tracking dengan log foto CS

module.exports = async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const CRM_TRACK_URL = process.env.CRM_TRACKING_SUPABASE_URL;
  const CRM_TRACK_KEY = process.env.CRM_TRACKING_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_KEY belum di-set' });
  }
  if (!CRM_TRACK_URL || !CRM_TRACK_KEY) {
    return res.status(500).json({ error: 'CRM_TRACKING_SUPABASE_URL / CRM_TRACKING_SERVICE_KEY belum di-set' });
  }

  const sbHeaders  = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const crmHeaders = { apikey: CRM_TRACK_KEY, Authorization: `Bearer ${CRM_TRACK_KEY}` };

  // ── POST: update room_work dengan log CS ─────────────────────────────────────
  if (req.method === 'POST') {
    const { resi, type, screenshot_url, cs_nama } = req.body || {};
    if (!resi || !type || !screenshot_url) {
      return res.status(400).json({ error: 'resi, type, screenshot_url wajib diisi' });
    }
    try {
      // Cek apakah row sudah ada di room_work
      const checkR = await fetch(
        `${CRM_TRACK_URL}/rest/v1/room_work?resi=eq.${encodeURIComponent(resi)}&select=resi`,
        { headers: crmHeaders }
      );
      const existing = checkR.ok ? await checkR.json() : [];

      const payload = {
        cs_log_type:           type,
        cs_log_screenshot_url: screenshot_url,
        cs_log_at:             new Date().toISOString(),
        cs_log_cs_nama:        cs_nama || null,
      };

      let r;
      if (Array.isArray(existing) && existing.length > 0) {
        // UPDATE existing row
        r = await fetch(
          `${CRM_TRACK_URL}/rest/v1/room_work?resi=eq.${encodeURIComponent(resi)}`,
          {
            method: 'PATCH',
            headers: { ...crmHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify(payload),
          }
        );
      } else {
        // INSERT new row
        r = await fetch(
          `${CRM_TRACK_URL}/rest/v1/room_work`,
          {
            method: 'POST',
            headers: { ...crmHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ resi, ...payload }),
          }
        );
      }
      if (!r.ok) return res.status(500).json({ error: await r.text() });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── GET: ambil semua BERMASALAH ───────────────────────────────────────────────
  if (req.method !== 'GET') return res.status(405).end();

  // 1. Ambil semua resi BERMASALAH dari cs_order_tracking_crm (Supabase utama)
  let trackData = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/cs_order_tracking_crm`
        + `?select=resi,ekspedisi,status_resi,status_resi_step,status_resi_updated_at,status_resi_detail`
        + `&status_resi=eq.BERMASALAH`
        + `&order=status_resi_updated_at.desc`
        + `&limit=${PAGE}&offset=${offset}`,
        { headers: sbHeaders }
      );
      if (!r.ok) break;
      const page = await r.json();
      if (!Array.isArray(page) || !page.length) break;
      trackData = trackData.concat(page);
      if (page.length < PAGE) break;
      offset += PAGE;
    } catch(_) { break; }
  }

  if (!trackData.length) return res.status(200).json([]);

  // 2. Ambil room_work dari CRM Tracking Supabase untuk resi BERMASALAH
  const resiList = trackData.map(t => t.resi);
  const rwMap    = {};
  const CHUNK    = 500;

  await Promise.all(
    Array.from({ length: Math.ceil(resiList.length / CHUNK) }, (_, i) =>
      resiList.slice(i * CHUNK, (i + 1) * CHUNK)
    ).map(async chunk => {
      const inFilter = chunk.map(r => `"${String(r).replace(/"/g, '')}"`).join(',');
      try {
        const r = await fetch(
          `${CRM_TRACK_URL}/rest/v1/room_work`
          + `?select=resi,order_date,cs_nama,nama_pembeli,hp_pembeli,kota_tujuan,ekspedisi,produk,case_undel,fu_count,fu_info_at,fu_1_at,fu_2_at,fu_3_at,cs_responded,cs_responded_at,lapor_ekspedisi,lapor_ekspedisi_at`
          + `&resi=in.(${inFilter})`,
          { headers: crmHeaders }
        );
        if (r.ok) {
          const data = await r.json();
          (Array.isArray(data) ? data : []).forEach(t => { rwMap[t.resi] = t; });
        }
      } catch(_) {}
    })
  );

  // 3. Merge dan return
  const results = trackData.map(t => ({
    resi:                   t.resi,
    ekspedisi:              t.ekspedisi              || null,
    status_resi:            t.status_resi            || null,
    status_resi_step:       t.status_resi_step       || null,
    status_resi_updated_at: t.status_resi_updated_at || null,
    status_resi_detail:     t.status_resi_detail     || null,
    _rw:                    rwMap[t.resi]             || null,
  }));

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(results);
};

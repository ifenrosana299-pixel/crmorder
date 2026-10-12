const { trackShipment, trackPos } = require('../lib/mengantar');
const { sendFonnteWA } = require('../lib/fonnte');

const COURIER_MAP = {
  'JNE':'JNE','JNT':'JT','SICEPAT':'SiCepat','LION':'lion',
  'SAP':'SAP','ANTERAJA':'anteraja','NINJA':'Ninja','IDEXPRESS':'iDexpress'
};

// Sama daftar dengan EKSPEDISI_LIST di js/app.js — disinkron manual (tidak ada build step)
const EKSPEDISI_LIST = [
  { key: 'JNE',      pattern: /\bJNE\b/i },
  { key: 'JNT',      pattern: /\bJNT\b|\bJ[&\+]?T\b|JALUR\s*NUGRAHA/i },
  { key: 'SICEPAT',  pattern: /\bSICEPAT\b|\bSICE\b/i },
  { key: 'ANTERAJA', pattern: /\bANTERAJA\b|\bANTER\b/i },
  { key: 'NINJA',    pattern: /\bNINJA\b/i },
  { key: 'SAP',      pattern: /\bSAP\b/i },
  { key: 'LION',     pattern: /\bLION\b/i },
  { key: 'TIKI',     pattern: /\bTIKI\b/i },
  { key: 'POS',      pattern: /\bPOS\s*INDONESIA\b|\bPOS\b/i },
  { key: 'REX',      pattern: /\bREX\b/i },
  { key: 'IDEXPRESS',pattern: /\bID\s*EXPRESS\b|\bIDEX\b/i },
  { key: 'GRAB',     pattern: /\bGRAB\b/i },
  { key: 'GOJEK',    pattern: /\bGOJEK\b|\bGOSEND\b/i },
];

function extractEkspedisi(text) {
  if (!text) return null;
  for (const e of EKSPEDISI_LIST) {
    if (e.pattern.test(text)) return e.key;
  }
  return null;
}

const ROWS_PER_RUN = 50;  // Vercel Hobby 10s limit — aman ~50 resi/run
const NEW_SLOTS    = 15;  // prioritas resi baru (belum pernah masuk tracking)
const ROT_SLOTS    = 35;  // rotation: resi aktif terlama belum dicek
const CONCURRENCY  = 8;
const API_TIMEOUT_MS = 7000; // per-resi timeout agar 1 resi lambat tidak block batch

// Promise.race timeout — underlying fetch tetap jalan tapi hasilnya di-ignore
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('API timeout')), ms))
  ]);
}

// Sinyal "bermasalah" terstruktur per kurir (bukan tebak kata) — disinkronkan manual dengan js/app.js:
// - JNE (via Mengantar): history[].type.group === 'UNDELIVERED' atau type.tag === 'actionRequired'
// - POS Indonesia: history[].reason_delivery terisi
// Kurir lain (J&T dkk) belum expose field terstruktur di Mengantar, jadi fallback ke keyword.
const RETUR_PATTERN   = /retur|dikembalikan|\brts\b|\brto\b|return to sender/i;
const PROBLEM_PATTERN = /gagal|kendala|bermasalah|problematic|tidak ditemukan|alamat tidak (lengkap|dikenal)|tidak ada orang|tidak ditempat|tidak dihuni|menunggu konfirmasi|disimpan di gudang|ditolak|pindah alamat|box undel/i;

// Pola buat hitung step tertinggi yang PERNAH tercapai di seluruh history — disinkronkan manual
// dengan js/app.js. Dipakai supaya resi Bermasalah/Retur nampilin posisi stepper yang beneran
// tercapai (misal OTW), bukan mentok di step tetap, walau status akhirnya gagal.
const OTW_PATTERN         = /sedang diantar|dalam pengantaran|out for delivery|kurir menuju|\botw\b|akan dikirim ke alamat penerima|with delivery courier|delivery courier|diantar ke alamat|on delivery|1st attempt|2nd attempt|percobaan/i;
const KOTA_TUJUAN_PATTERN = /kota tujuan|gudang tujuan|tiba di kota|received at destination|received at warehouse|process and forward|inbound|sti-dest/i;

// Port dari js/shared.js AdsyCRM (sesi 2026-07-10, validasi ~15 resi asli JNT/Lion/JNE/POS):
// - isPickupPhase: entry code ada kata "PICKUP" (fase jemput dari pengirim di kota ASAL) di-skip
//   dari cek OTW/Bermasalah/Kota Tujuan — kata "gagal"/"percobaan" di fase ini soal jemput dari
//   toko, bukan progress ke penerima (resi Lion asli C1QSTIEB: "GAGAL DIJEMPUT...PERCOBAAN
//   PENJEMPUTAN ULANG" kepancing OTW/Bermasalah padahal blm sampai kota tujuan sama sekali).
// - isSelfReceipt: "diterima oleh X" cuma SAMPAI kalau X beda dari counter/kota entry itu sendiri
//   (J&T pake frasa sama buat "diterima oleh COUNTER ASAL buat manifest" vs "diterima oleh
//   PENERIMA" — resi asli JJ6000055580).
// - hasReceivedBy: field `receiver` J&T cuma keisi PAS beneran diterima penerima; J&T juga punya
//   format "Paket telah diterima" TANPA kata "oleh X" yang gak ketangkep regex (resi JJ6000043832).
function isPickupPhase(e) {
  return !!(e && e.code && /pickup/i.test(e.code));
}
function isSelfReceipt(e) {
  if (!e || !e.place) return false;
  const m = /diterima oleh\s+(.+)/i.exec(e.descOnly || '');
  if (!m) return false;
  const norm = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return norm(m[1]) === norm(e.place);
}
function hasReceivedBy(e) {
  return !!(e && e.receivedBy);
}

function computeProgressStep(entries) {
  let step = 2; // resi sudah discan sistem kurir minimal = Dikirim
  (entries || []).forEach(e => {
    if (isPickupPhase(e)) return;
    const d = (e.desc || '').toLowerCase();
    if (OTW_PATTERN.test(d)) step = Math.max(step, 4);
    // e.atDestination = sinyal terstruktur POS (bandingin kode cabang event vs kode cabang tujuan
    // order) — teks POS pake "tiba di Cabang X", bukan "tiba di kota" kayak di pattern, jadi gak
    // kedeteksi kalau cuma andelin regex. Ketauan dari resi asli BAC04072635010ACF3B9.
    else if (e.atDestination || KOTA_TUJUAN_PATTERN.test(d)) step = Math.max(step, 3);
  });
  return step;
}

// Heuristik best-effort dari sinyal terstruktur + teks history kurir Indonesia — tuning lanjutan
// kemungkinan masih perlu setelah lihat lebih banyak sampel data asli.
// Return { stage, step } — step = posisi tertinggi di stepper 5 tahap yang pernah tercapai.
function mapTrackingStage({ resi, statusCategory, entries }) {
  if (!resi) return { stage: 'MENUNGGU_RESI', step: 1 };
  const cat = (statusCategory || '').toUpperCase();
  const arr = Array.isArray(entries) ? entries : [];
  const latest = arr.length ? arr[arr.length - 1] : null;
  const latestDesc = (latest && latest.desc || '').toLowerCase();
  const reachedStep = computeProgressStep(arr);

  let stage;
  if (cat.includes('RETUR') || cat.includes('RETURN') || arr.some(e => RETUR_PATTERN.test(e.desc || ''))) {
    stage = 'RETUR';
  } else if (cat === 'DELIVERED' || (/diterima oleh|\bdelivered\b|\bpod\b/.test(latestDesc) && !isSelfReceipt(latest)) || hasReceivedBy(latest)) {
    stage = 'SAMPAI';
  } else {
    const hasStructuredProblem = arr.some(e => !isPickupPhase(e) && (e.group === 'UNDELIVERED' || e.tag === 'actionRequired' || !!e.reasonDelivery));
    if (hasStructuredProblem || arr.some(e => !isPickupPhase(e) && !e.isPos && PROBLEM_PATTERN.test(e.desc || ''))) {
      stage = 'BERMASALAH';
    } else if (reachedStep >= 4) {
      stage = 'OTW';
    } else if (reachedStep >= 3) {
      stage = 'KOTA_TUJUAN';
    } else {
      stage = 'DIKIRIM';
    }
  }
  return { stage, step: stage === 'SAMPAI' ? 5 : reachedStep };
}

function normalizeMengantar(json) {
  if (!json || !json.success || !json.data) return null;
  const d = json.data;
  const history = Array.isArray(d.history) ? d.history : [];
  // Gabung desc + code — beberapa kurir (Lion: "STI-DEST"/"POD"/"DEL") taruh sinyal penting di code, bukan desc.
  // descOnly/code/place/receivedBy dipisah lagi buat isPickupPhase()/isSelfReceipt()/hasReceivedBy()
  // yang butuh field asli.
  const entries = history.map(h => ({
    desc: [h.desc, h.code].filter(Boolean).join(' '),
    descOnly: h.desc || '',
    code: h.code || null,
    place: h.counter_name || h.city_name || null,
    receivedBy: (h.receiver || '').trim() || null,
    group: (h.type && h.type.group) || null,
    tag: (h.type && h.type.tag) || null,
    reasonDelivery: null
  }));
  return {
    statusCategory: d.statusCategory || d.status || '',
    entries,
    detail: { history, receiver: d.RECEIVER_NAME || null, city: d.RECEIVER_CITY || null }
  };
}

function normalizePos(json) {
  if (!json || !json.success || !json.data) return null;
  const d = json.data;
  const history = Array.isArray(d.connote_history) ? d.connote_history : [];
  // reasonDelivery = ANY percobaan antar gagal/reschedule (reason_delivery keisi) -- by design
  // langsung dianggep BERMASALAH dari percobaan pertama gagal (keputusan user, sesi 2026-07-10
  // AdsyCRM: biar CS bisa proaktif follow up ke pembeli, bukan nunggu kurir nyerah total).
  // isPos = true -> desc-nya di-skip dari tebak-kata PROBLEM_PATTERN generik (dipinjem dari
  // kosakata JNE) -- problem POS udah ditentuin murni dari reasonDelivery, gak perlu tebak dari
  // teks bebas lagi (mencegah jalur lain nyasar kayak "tidak ditempat").
  // destNopen = kode cabang tujuan akhir order (bukan kprk/hub induk) -- dipakai bandingin ke nopen
  // tiap event INLOCATION buat mastiin "tiba di cabang TUJUAN" vs cuma numpang lewat hub.
  const destNopen = (d.connote_customfield && d.connote_customfield.destination_nopen) || null;
  const entries = history.map(h => ({
    desc: [h.content, h.content2].filter(Boolean).join(' '),
    group: null, tag: null, isPos: true,
    atDestination: !!(destNopen && h.state === 'INLOCATION' && h.nopen === destNopen),
    reasonDelivery: h.reason_delivery || null
  }));
  return {
    statusCategory: d.connote_state || '',
    entries,
    detail: { history, receiver: d.connote_receiver_name || null, city: null }
  };
}

async function checkOneResi(resi, ekspedisi) {
  const eks = (ekspedisi || '').toUpperCase();
  try {
    let normalized;
    if (eks === 'POS' || eks.includes('POS')) {
      normalized = normalizePos(await trackPos(resi));
    } else {
      const courier = COURIER_MAP[ekspedisi] || COURIER_MAP[eks] || ekspedisi;
      if (!courier) return null;
      normalized = normalizeMengantar(await trackShipment(resi, courier));
    }
    if (!normalized) return null;
    const { stage, step } = mapTrackingStage({ resi, ...normalized });
    return { stage, step, detail: normalized.detail };
  } catch (e) {
    return null;
  }
}

const STAGE_LABEL = {
  BERMASALAH: '⚠️ Bermasalah',
  RETUR:      '↩️ Retur'
};

// Semua kemungkinan format HP yang sama (08xxx/8xxx/628xxx) — orderan_masuk_crm.hp formatnya
// gak terjamin konsisten (tergantung apa adanya CS ketik), jadi query harus toleran ke-3nya.
function hpVariants(raw) {
  let s = (raw || '').replace(/\D/g, '');
  if (!s) return [];
  if (s.startsWith('62')) s = s.slice(2);
  else if (s.startsWith('0')) s = s.slice(1);
  const noZero = s;
  return [...new Set(['0' + noZero, noZero, '62' + noZero])];
}

// Cek apakah last_notif_at sudah hari ini (WIB) — untuk anti-spam 1x/hari
function isNotifiedToday(isoStr) {
  if (!isoStr) return false;
  const today     = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const notifDate = new Date(isoStr).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  return today === notifDate;
}

// Notif WA ke CS pemilik order tiap hari selama masih BERMASALAH (max 1x/hari per resi)
async function notifyCsProblem(sbHeaders, SUPABASE_URL, order, resi, stage) {
  const hpVar = hpVariants(order.hp);
  if (!hpVar.length) return false;
  const hp08 = hpVar[0];
  const tgl  = (order.tanggal || '').slice(0, 10);

  const masukFilter = new URLSearchParams({
    select: 'cs_id',
    hp: `in.(${hpVar.join(',')})`,
    tanggal: `eq.${tgl}`,
    limit: '1'
  });
  const masukRes = await fetch(`${SUPABASE_URL}/rest/v1/orderan_masuk_crm?${masukFilter.toString()}`, { headers: sbHeaders });
  const masukRows = await masukRes.json();
  const csId = Array.isArray(masukRows) && masukRows[0] ? masukRows[0].cs_id : null;
  if (!csId) return false;

  const profFilter = new URLSearchParams({ select: 'nama,no_wa', id: `eq.${csId}`, limit: '1' });
  const profRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_profiles?${profFilter.toString()}`, { headers: sbHeaders });
  const profRows = await profRes.json();
  const profile = Array.isArray(profRows) ? profRows[0] : null;
  if (!profile || !profile.no_wa) return false;

  const msg =
    `⚠️ *CS Input — Tracking Order*\n\n` +
    `Halo ${profile.nama || 'CS'} 👋\n` +
    `Order kamu berubah status jadi *${STAGE_LABEL[stage] || stage}*:\n\n` +
    `👤 Nama : ${order.nama || '—'}\n` +
    `📱 HP   : ${hp08}\n` +
    `📦 Resi : ${resi}\n\n` +
    `Mohon segera cek & follow up ke customer ya.\nTerima Kasih 🙏`;

  await sendFonnteWA(SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, profile.no_wa, msg, 'notif-bermasalah');
  return true;
}

module.exports = async function handler(req, res) {
  const secret = req.query.secret || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const sbHeaders = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };

  let checked = 0, updated = 0, errors = 0, notified = 0;

  try {
    const seenResi = new Set();
    const targets   = []; // { resi, ekspedisi, hp, tanggal, nama, prevStatus }

    // ── SLOT 1: Resi baru (belum pernah masuk cs_order_tracking_crm) ──────────────
    // Ambil 120 order terbaru dari all_orderan (14 hari terakhir) lalu cek mana
    // yang belum ada di tracking sama sekali → prioritas dicek duluan.
    const since14d = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
    const recentFilter = new URLSearchParams({
      select: 'resi,pembayaran,hp,tanggal,nama',
      sumber: 'eq.cs_input',
      resi: 'not.is.null',
      created_at: `gte.${since14d}`,
      order: 'id.desc',
      limit: '120'
    });
    const recentRows = await (await fetch(`${SUPABASE_URL}/rest/v1/all_orderan?${recentFilter}`, { headers: sbHeaders })).json();

    // Dedup by resi
    const recentByResi = {};
    (Array.isArray(recentRows) ? recentRows : []).forEach(r => {
      const resi = (r.resi || '').trim();
      if (resi && !recentByResi[resi]) recentByResi[resi] = r;
    });
    const recentResiList = Object.keys(recentByResi);

    // Cek mana yang sudah ada di cs_order_tracking_crm (status apapun)
    const alreadyInTracking = new Set();
    if (recentResiList.length) {
      const chkFilter = new URLSearchParams({
        select: 'resi',
        resi: `in.(${recentResiList.map(r => `"${r.replace(/"/g, '')}"`).join(',')})`
      });
      const chkRows = await (await fetch(`${SUPABASE_URL}/rest/v1/cs_order_tracking_crm?${chkFilter}`, { headers: sbHeaders })).json();
      (Array.isArray(chkRows) ? chkRows : []).forEach(r => alreadyInTracking.add(r.resi));
    }

    for (const resi of recentResiList) {
      if (targets.length >= NEW_SLOTS) break;
      if (alreadyInTracking.has(resi)) continue;
      seenResi.add(resi);
      const r = recentByResi[resi];
      targets.push({
        resi,
        ekspedisi: extractEkspedisi(r.pembayaran || ''),
        hp: r.hp, tanggal: r.tanggal, nama: r.nama,
        prevStatus: null
      });
    }

    // ── SLOT 2: Rotation — resi aktif terlama belum dicek ─────────────────────
    // Query dari cs_order_tracking_crm: tidak SAMPAI/RETUR, urut updated_at ASC
    // (yang paling lama dicek = paling atas antrian).
    const rotFilter = new URLSearchParams({
      select: 'resi,ekspedisi,status_resi,last_notif_at',
      status_resi: 'not.in.(SAMPAI,RETUR)',
      order: 'status_resi_updated_at.asc.nullsfirst',
      limit: String(ROT_SLOTS + 20) // ambil lebih, biar ada buffer setelah dedup
    });
    const rotRows = await (await fetch(`${SUPABASE_URL}/rest/v1/cs_order_tracking_crm?${rotFilter}`, { headers: sbHeaders })).json();

    // Kumpulkan resi rotation yang belum masuk targets
    const rotCandidates = (Array.isArray(rotRows) ? rotRows : []).filter(r => !seenResi.has(r.resi));
    const rotResiList   = rotCandidates.map(r => r.resi).slice(0, ROT_SLOTS);

    // Fetch info order (hp, tanggal, nama) untuk kebutuhan notif WA
    const rotOrderInfo = {};
    if (rotResiList.length) {
      const orderFilter = new URLSearchParams({
        select: 'resi,pembayaran,hp,tanggal,nama',
        sumber: 'eq.cs_input',
        resi: `in.(${rotResiList.map(r => `"${r.replace(/"/g, '')}"`).join(',')})`,
        limit: String(rotResiList.length)
      });
      const orderRows = await (await fetch(`${SUPABASE_URL}/rest/v1/all_orderan?${orderFilter}`, { headers: sbHeaders })).json();
      (Array.isArray(orderRows) ? orderRows : []).forEach(r => {
        if (!rotOrderInfo[r.resi]) rotOrderInfo[r.resi] = r;
      });
    }

    for (const row of rotCandidates) {
      if (targets.length >= ROWS_PER_RUN) break;
      seenResi.add(row.resi);
      const info = rotOrderInfo[row.resi] || {};
      targets.push({
        resi: row.resi,
        ekspedisi: row.ekspedisi || extractEkspedisi(info.pembayaran || ''),
        hp: info.hp, tanggal: info.tanggal, nama: info.nama,
        prevStatus: row.status_resi,
        last_notif_at: row.last_notif_at || null
      });
    }

    if (!targets.length) {
      return res.status(200).json({ checked: 0, updated: 0, errors: 0, notified: 0, new_resi: 0 });
    }

    // ── Cek tracking per resi (8 paralel) ────────────────────────────────────
    const newResiCount = targets.filter(t => !t.prevStatus).length;

    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const batch = targets.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async target => {
        try {
          checked++;
          // withTimeout 7s: 1 resi lambat tidak block seluruh batch
          const result = await withTimeout(checkOneResi(target.resi, target.ekspedisi), API_TIMEOUT_MS);
          if (!result) return;

          await fetch(`${SUPABASE_URL}/rest/v1/cs_order_tracking_crm?on_conflict=resi`, {
            method: 'POST',
            headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({
              resi: target.resi,
              ekspedisi: target.ekspedisi,
              status_resi: result.stage,
              status_resi_step: result.step,
              status_resi_updated_at: new Date().toISOString(),
              status_resi_detail: result.detail
            })
          });
          updated++;

          // Notif WA ke CS tiap hari selama masih BERMASALAH (max 1x/hari per resi)
          // RETUR tidak kirim notif harian — cukup sekali saat pertama kali berubah ke RETUR
          const isProblem = result.stage === 'BERMASALAH';
          const isNewRetur = result.stage === 'RETUR' && result.stage !== target.prevStatus;
          const shouldNotif = isProblem && !isNotifiedToday(target.last_notif_at);
          if (shouldNotif || isNewRetur) {
            try {
              const sent = await notifyCsProblem(sbHeaders, SUPABASE_URL, target, target.resi, result.stage);
              if (sent) {
                notified++;
                // Update last_notif_at supaya tidak spam hari yang sama
                await fetch(`${SUPABASE_URL}/rest/v1/cs_order_tracking_crm?resi=eq.${encodeURIComponent(target.resi)}`, {
                  method: 'PATCH',
                  headers: { ...sbHeaders, Prefer: 'return=minimal' },
                  body: JSON.stringify({ last_notif_at: new Date().toISOString() })
                });
              }
            } catch (e) { /* notif gagal, tracking tetap tersimpan */ }
          }
        } catch (e) {
          errors++;
        }
      }));
    }

    res.status(200).json({ checked, updated, errors, notified, new_resi: newResiCount, total: targets.length });
  } catch (e) {
    res.status(500).json({ error: e.message, checked, updated, errors, notified });
  }
};

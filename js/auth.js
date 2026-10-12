// ── SUPABASE CONFIG ───────────────────────────────────────────────────────────
// Sama dengan ValidasiOrder — shared database
const SUPABASE_URL = 'https://lqpcnzdssvvcayqvdjxs.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxcGNuemRzc3Z2Y2F5cXZkanhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMTgxMDIsImV4cCI6MjA5MDU5NDEwMn0.4M4okAfJWhBD6AbL71utafrFL-ZgbVxcz3ANLnG_jH4';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── SUPABASE STORAGE (project terpisah khusus SS bukti) ───────────────────────
const SS_SUPABASE_URL = 'https://ppryuktvzaboahcphqqg.supabase.co';
const SS_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwcnl1a3R2emFib2FoY3BocXFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3ODQxNDMsImV4cCI6MjA5ODM2MDE0M30.MZJC-QAuxkTume3Zgy-5pOgDpwpsntbeeHRT-r8Nk18';
const sbSS = createClient(SS_SUPABASE_URL, SS_SUPABASE_KEY);

// ── AUTH ──────────────────────────────────────────────────────────────────────
async function signUp(email, password, nama, noWA) {
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { nama, no_wa: noWA, role: 'crm' } }
  });
  if (error) throw error;

  // Buat profile row
  if (data.user) {
    await sb.from('cs_profiles').upsert({
      id: data.user.id,
      nama,
      no_wa: noWA,
      email,
      aktif: true
    });
  }
  return data;
}

async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

async function getUser() {
  const { data } = await sb.auth.getUser();
  return data.user;
}

async function requireAuth() {
  const session = await getSession();
  if (!session) { window.location.href = 'index.html'; return null; }
  return session.user;
}

// ── PROFILE ───────────────────────────────────────────────────────────────────
async function getProfile(userId) {
  const { data, error } = await sb.from('cs_profiles').select('*').eq('id', userId).single();
  if (error) return null;
  return data;
}

async function updateProfile(userId, updates) {
  const { error } = await sb.from('cs_profiles').update(updates).eq('id', userId);
  if (error) throw error;
}

// ── NORMALIZE HELPERS ─────────────────────────────────────────────────────────
function normalizeHP(hp) {
  if (!hp && hp !== 0) return '';
  let s = String(hp).trim().replace(/\D/g, '');
  if (!s) return '';
  if (s.startsWith('62')) s = '0' + s.slice(2);
  if (s.startsWith('8'))  s = '0' + s;
  return s;
}

// Semua kemungkinan format HP yang sama (08xxx/8xxx/628xxx) — dipakai buat query
// tabel yang formatnya gak terjamin konsisten (all_orderan/orderan_masuk_crm pernah
// kesimpen beda format karena bug normalisasi lama, lihat catatan 2026-07-13).
function hpVariants(hp) {
  const norm = normalizeHP(hp); // 08xxx
  if (!norm) return [];
  const noZero = norm.slice(1);       // 8xxx
  const with62 = '62' + noZero;       // 628xxx
  return [...new Set([norm, noZero, with62])];
}

// ── SUPABASE SQL SETUP ────────────────────────────────────────────────────────
// Jalankan SQL ini di Supabase SQL Editor sebelum pertama kali digunakan:
//
// -- Tabel profil CS
// CREATE TABLE IF NOT EXISTS cs_profiles (
//   id uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
//   nama text NOT NULL,
//   no_wa text DEFAULT '',
//   email text,
//   aktif boolean DEFAULT true,
//   created_at timestamptz DEFAULT now(),
//   updated_at timestamptz DEFAULT now()
// );
// ALTER TABLE cs_profiles ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "cs_own_profile" ON cs_profiles FOR ALL USING (auth.uid() = id);
//
// -- Tabel orderan dari CS
// CREATE TABLE IF NOT EXISTS orderan_masuk_crm (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   created_at timestamptz DEFAULT now(),
//   tanggal date DEFAULT CURRENT_DATE,
//   cs_id uuid REFERENCES cs_profiles(id),
//   cs_nama text,
//   no text, nama text, hp text, alamat text,
//   kelurahan text, kecamatan text, kabupaten text, provinsi text, kodepos text,
//   jumlah_pesanan text, quantity text, pembayaran text, total_pembayaran text,
//   instruksi_pengiriman text, keterangan text, rincian_pembayaran text, keluhan text,
//   is_dup_today boolean DEFAULT false,
//   is_dup_all boolean DEFAULT false,
//   is_rts boolean DEFAULT false,
//   rts_detail jsonb,
//   dup_detail jsonb,
//   acc_spv text,
//   noted text,
//   wa_notif_sent boolean DEFAULT false,
//   raw_input text
// );
// ALTER TABLE orderan_masuk_crm ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "cs_insert_own" ON orderan_masuk_crm FOR INSERT WITH CHECK (auth.uid() = cs_id);
// CREATE POLICY "cs_read_own"   ON orderan_masuk_crm FOR SELECT USING (auth.uid() = cs_id);
// CREATE POLICY "cs_update_own" ON orderan_masuk_crm FOR UPDATE USING (auth.uid() = cs_id);
// -- Allow SPV/admin read all (set via Supabase service role or separate policy)
// CREATE POLICY "all_orderan_read" ON all_orderan FOR SELECT TO authenticated USING (true);
// CREATE POLICY "all_rts_read"     ON all_rts     FOR SELECT TO authenticated USING (true);
//
// -- Kolom Grade/Skor Penerima (Mengantar), diisi via api/grade.js + validateReceiverScore() di js/app.js
// ALTER TABLE orderan_masuk_crm ADD COLUMN IF NOT EXISTS receiver_score jsonb;
//
// -- Tabel hasil tracking resi live (Tracking Order) — diisi oleh api/cron-check-resi.js
// -- dan tombol "Cek Ulang"/"Refresh Semua" di halaman Tracking Order
// CREATE TABLE IF NOT EXISTS cs_order_tracking_crm (
//   resi text PRIMARY KEY,
//   ekspedisi text,
//   status_resi text,
//   status_resi_step int,
//   status_resi_updated_at timestamptz,
//   status_resi_detail jsonb,
//   created_at timestamptz DEFAULT now()
// );
// ALTER TABLE cs_order_tracking_crm ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "cs_order_tracking_crm_read"  ON cs_order_tracking_crm FOR SELECT TO authenticated USING (true);
// CREATE POLICY "cs_order_tracking_crm_write" ON cs_order_tracking_crm FOR ALL    TO authenticated USING (true);
//
// -- Env var tambahan yang perlu diset di Vercel:
// -- CRON_SECRET            = token rahasia buat auth cron (dipakai api/cron-check-resi.js)
// -- SUPABASE_URL           = URL project Supabase (sudah dipakai api/notif.js)
// -- SUPABASE_SERVICE_KEY   = service role key Supabase (sudah dipakai api/notif.js)
// --
// -- Setelah deploy, setup cron eksternal (mis. cron-job.org) tiap 3-4 jam hit:
// --   GET/POST https://<domain>/api/cron-check-resi
// --   Header: Authorization: Bearer <CRON_SECRET>
// -- (Vercel Hobby plan cron native cuma 1x/hari — sama pola dengan adsycrm-main)

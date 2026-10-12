module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { text } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'text wajib diisi' });
  }

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) {
    return res.status(500).json({ error: 'OpenAI API key belum dikonfigurasi di environment' });
  }

  const SYSTEM_PROMPT = `Kamu adalah parser data orderan penjualan. Tugasmu mengekstrak data dari teks order mentah dan mengembalikannya dalam format JSON.

Aturan ekstraksi:
- no: ambil baris pertama secara lengkap (termasuk nomor, nama ekspedisi, strip, keterangan, dll)
- nama: nama lengkap customer SAJA. Kalau baris nama mengandung tanda "|" (order kombo sering
  nempel catatan produk singkat di belakang nama, contoh "ARIS JONO|ORI 1+MAK 1"), ambil HANYA
  bagian SEBELUM tanda "|" pertama — bagian setelahnya BUKAN bagian dari nama
- hp: nomor HP lengkap dengan semua digit
- alamat: teks mulai setelah kata "ANGAN DIRETUR BARANG PENTING" sampai sebelum tanda "|". Jika tidak ada frasa itu, ambil baris alamat lengkap
- kelurahan, kecamatan, kabupaten, provinsi, kodepos: ambil dari baris-baris setelah alamat
- instruksi_pengiriman: teks sebelum tanda "|" pertama dari baris yang mengandung "Pengirim CS"
- rincian_pembayaran: angka-angka setelah "|" dari baris instruksi pengiriman, format aslinya (contoh: 11000|0|5000|0|100000)
- jumlah_pesanan: jumlah unit lengkap (contoh: "2 BOTOL NEW HERBAPIL", "1 BOX GHAZI")
- quantity: angka saja dari jumlah pesanan (contoh: "2", "1")
- pembayaran: metode pembayaran (contoh: "COD JNE REG", "TRANSFER JNE MENG", "COD LION MENG")
- total_pembayaran: nilai total rupiah (angka saja tanpa Rp, contoh: "166000")
- keterangan: baris TERSENDIRI yang biasanya muncul di antara baris "Total Pembayaran" dan baris
  "Keluhan"/"KELUHAN", formatnya ringkasan produk+qty+nama CS, contoh: "NEW PRIMAGOLD 4 CS HUSNA"
  atau "NEW SALEB OIRI 1 + MAKSIR 1 CS AMBAR". WAJIB tetap diambil apa adanya walaupun isinya
  terlihat mirip/duplikat dengan jumlah_pesanan atau instruksi_pengiriman — itu BUKAN alasan buat
  mengosongkannya, dua-duanya boleh terlihat mirip. Kosongkan HANYA kalau baris seperti ini
  benar-benar tidak ada sama sekali di teks
- keluhan: teks setelah kata "keluhan:" jika ada, kosongkan jika tidak ada

Kembalikan HANYA JSON valid dengan keys persis ini:
no, nama, hp, alamat, kelurahan, kecamatan, kabupaten, provinsi, kodepos,
jumlah_pesanan, quantity, pembayaran, total_pembayaran,
instruksi_pengiriman, keterangan, rincian_pembayaran, keluhan

Jika field tidak ditemukan isi dengan string kosong "".`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.1,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text.trim() }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: 'OpenAI error: ' + err.slice(0, 200) });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return res.status(500).json({ error: 'Respon kosong dari OpenAI' });

    const parsed = JSON.parse(content);
    return res.status(200).json({ ok: true, data: parsed });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

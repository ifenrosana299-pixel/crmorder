module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const phone = (req.query.phone || '').replace(/\D/g, '');
  if (!phone) return res.status(400).json({ error: 'phone wajib diisi' });

  const apiKey = process.env.MENGANTAR_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'MENGANTAR_API_KEY belum diset di Vercel' });

  try {
    const r = await fetch(
      `https://api-public.mengantar.com/api/public/${apiKey}/getReceiverScoreByNumberUser?search=${encodeURIComponent(phone)}`,
      { headers: { 'Accept': 'application/json' } }
    );
    const json = await r.json();
    return res.status(200).json(json);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

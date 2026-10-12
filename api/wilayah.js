module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q wajib diisi' });

  try {
    const r = await fetch(
      `https://app.mengantar.com/api/address/autofill?keyword=${encodeURIComponent(q)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Referer': 'https://www.mengantar.com/' } }
    );
    const json = await r.json();
    const list = json?.data || (Array.isArray(json) ? json : []);
    return res.status(200).json({ ok: true, data: list });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};

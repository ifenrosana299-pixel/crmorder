const { sendFonnteWA } = require('../lib/fonnte');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { target, message } = req.body || {};
  if (!target || !message) {
    return res.status(400).json({ error: 'target dan message wajib diisi' });
  }

  try {
    const data = await sendFonnteWA(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, target, message);
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

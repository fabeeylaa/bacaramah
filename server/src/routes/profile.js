import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const DEFAULTS = {
  font_family: 'sans',
  font_size: 18,
  line_height: 1.6,
  letter_spacing: 0,
  column_width: 60,
  background: 'putih',
  line_focus: false,
  syllable_split: false,
  tts_rate: 1,
};

const RULES = {
  font_family: { type: 'enum', values: ['sans', 'serif', 'mono', 'dyslexic'] },
  font_size: { type: 'int', min: 14, max: 40 },
  line_height: { type: 'num', min: 1.2, max: 2.5 },
  letter_spacing: { type: 'num', min: 0, max: 0.3 },
  column_width: { type: 'int', min: 30, max: 100 },
  background: { type: 'enum', values: ['putih', 'krem', 'kuning', 'abu', 'gelap'] },
  line_focus: { type: 'bool' },
  syllable_split: { type: 'bool' },
  tts_rate: { type: 'num', min: 0.5, max: 2 },
};

const COLS = Object.keys(DEFAULTS);

function cleanPatch(body) {
  const patch = {};
  for (const [key, rule] of Object.entries(RULES)) {
    const v = body[key];
    if (v === undefined) continue;

    let ok = false;
    if (rule.type === 'enum') ok = rule.values.includes(v);
    else if (rule.type === 'bool') ok = typeof v === 'boolean';
    else if (rule.type === 'int') ok = Number.isInteger(v) && v >= rule.min && v <= rule.max;
    else ok = typeof v === 'number' && Number.isFinite(v) && v >= rule.min && v <= rule.max;

    if (!ok) return { error: `Nilai ${key} tidak valid` };
    patch[key] = v;
  }
  return { patch };
}

async function getProfile(userId) {
  const result = await pool.query(
    `SELECT ${COLS.join(', ')} FROM reading_profiles WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

// ambil profil; kalau belum pernah disimpan, kirim nilai bawaan
router.get('/', async (req, res) => {
  try {
    const saved = await getProfile(req.user.id);
    res.json({ profile: saved || DEFAULTS, saved: Boolean(saved) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Terjadi kesalahan di server' });
  }
});

// simpan profil; boleh kirim sebagian field saja
router.put('/', async (req, res) => {
  const { patch, error } = cleanPatch(req.body || {});
  if (error) return res.status(400).json({ message: error });

  try {
    const current = (await getProfile(req.user.id)) || DEFAULTS;
    const next = { ...current, ...patch };

    const result = await pool.query(
      `INSERT INTO reading_profiles (user_id, ${COLS.join(', ')})
       VALUES ($1, ${COLS.map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (user_id) DO UPDATE
       SET ${COLS.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = NOW()
       RETURNING ${COLS.join(', ')}`,
      [req.user.id, ...COLS.map((c) => next[c])]
    );
    res.json({ profile: result.rows[0], saved: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Terjadi kesalahan di server' });
  }
});

export default router;
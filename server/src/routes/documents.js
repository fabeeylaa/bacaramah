import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const MAX_CONTENT = 300000;

router.use(requireAuth);

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Terjadi kesalahan di server' });
  }
};

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validate(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!title) return { error: 'Judul wajib diisi' };
  if (title.length > 200) return { error: 'Judul maksimal 200 karakter' };
  if (!content) return { error: 'Isi bacaan wajib diisi' };
  if (content.length > MAX_CONTENT) {
    return { error: `Isi bacaan maksimal ${MAX_CONTENT} karakter` };
  }
  return { title, content };
}

// daftar dokumen milik user (tanpa isi penuh)
router.get(
  '/',
  handle(async (req, res) => {
    const result = await pool.query(
      `SELECT id, title, source, created_at, updated_at, LEFT(content, 150) AS preview
       FROM documents
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ documents: result.rows });
  })
);

// tambah dokumen dari teks yang ditempel
router.post(
  '/',
  handle(async (req, res) => {
    const data = validate(req.body);
    if (data.error) return res.status(400).json({ message: data.error });

    const result = await pool.query(
      `INSERT INTO documents (user_id, title, content, source)
       VALUES ($1, $2, $3, 'text')
       RETURNING *`,
      [req.user.id, data.title, data.content]
    );
    res.status(201).json({ document: result.rows[0] });
  })
);

// satu dokumen lengkap
router.get(
  '/:id',
  handle(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: 'ID tidak valid' });

    const result = await pool.query(
      'SELECT * FROM documents WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Dokumen tidak ditemukan' });
    }
    res.json({ document: result.rows[0] });
  })
);

// ubah judul dan isi
router.put(
  '/:id',
  handle(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: 'ID tidak valid' });

    const data = validate(req.body);
    if (data.error) return res.status(400).json({ message: data.error });

    const result = await pool.query(
      `UPDATE documents
       SET title = $1, content = $2, updated_at = NOW()
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      [data.title, data.content, id, req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Dokumen tidak ditemukan' });
    }
    res.json({ document: result.rows[0] });
  })
);

// hapus dokumen
router.delete(
  '/:id',
  handle(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: 'ID tidak valid' });

    const result = await pool.query(
      'DELETE FROM documents WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Dokumen tidak ditemukan' });
    }
    res.json({ message: 'Dokumen dihapus' });
  })
);

export default router;
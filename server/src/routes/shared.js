import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// halaman baca publik lewat tautan: tidak perlu login
router.get('/:token', async (req, res) => {
  const { token } = req.params;
  const notFound = { message: 'Tautan tidak ditemukan atau sudah dicabut' };

  if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) {
    return res.status(404).json(notFound);
  }

  try {
    const result = await pool.query(
      `SELECT d.title, d.content, d.source, d.created_at, u.name AS author_name
       FROM shared_links s
       JOIN documents d ON d.id = s.document_id
       JOIN users u ON u.id = d.user_id
       WHERE s.token = $1 AND s.revoked_at IS NULL`,
      [token]
    );
    if (!result.rows[0]) return res.status(404).json(notFound);
    res.json({ document: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Terjadi kesalahan di server' });
  }
});

export default router;
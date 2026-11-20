import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import multer from 'multer';
import path from 'path';
import { extractText, ALLOWED_EXT } from '../lib/extractText.js';
import crypto from 'crypto';

const router = Router();
const MAX_CONTENT = 300000;
const MAX_FILE_MB = 5;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 1 },
});

function receiveFile(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: `Ukuran file maksimal ${MAX_FILE_MB} MB` });
    }
    return res.status(400).json({ message: 'File gagal diunggah' });
  });
}

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
            `SELECT d.id, d.title, d.source, d.created_at, d.updated_at,
              LEFT(d.content, 150) AS preview,
              (SELECT s.token FROM shared_links s
               WHERE s.document_id = d.id AND s.revoked_at IS NULL) AS share_token,
              CASE
                WHEN EXISTS (SELECT 1 FROM shared_links s
                             WHERE s.document_id = d.id AND s.revoked_at IS NULL) THEN 'aktif'
                WHEN EXISTS (SELECT 1 FROM shared_links s
                             WHERE s.document_id = d.id) THEN 'dicabut'
                ELSE 'belum'
              END AS share_status
       FROM documents d
       WHERE d.user_id = $1
       ORDER BY d.created_at DESC`,
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

// unggah PDF/DOCX, ambil teksnya, simpan sebagai dokumen
router.post(
  '/import',
  receiveFile,
  handle(async (req, res) => {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ message: 'Pilih file PDF atau DOCX dulu' });
    }

    // nama file dari multer bisa terbaca sebagai latin1, kembalikan ke UTF-8
    const originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return res.status(400).json({ message: 'Hanya file PDF atau DOCX yang bisa diunggah' });
    }

    let result;
    try {
      result = await extractText({ originalname, buffer: file.buffer });
    } catch {
      return res.status(422).json({
        message: 'File tidak bisa dibaca. Pastikan file tidak rusak atau diproteksi.',
      });
    }

    if (!result.text) {
      return res.status(422).json({
        message:
          'Tidak ada teks yang bisa dibaca. Kalau file ini hasil scan atau foto, coba tempel teksnya langsung.',
      });
    }
    if (result.text.length > MAX_CONTENT) {
      return res.status(413).json({
        message: `Teks terlalu panjang (maksimal ${MAX_CONTENT} karakter)`,
      });
    }

    const typedTitle = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    const title = (typedTitle || path.basename(originalname, ext)).slice(0, 200);

    const saved = await pool.query(
      `INSERT INTO documents (user_id, title, content, source)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.user.id, title, result.text, result.source]
    );
    res.status(201).json({ document: saved.rows[0] });
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

function requireGuru(req, res, next) {
  if (req.user.role !== 'guru') {
    return res.status(403).json({ message: 'Hanya guru yang bisa membagikan materi' });
  }
  next();
}

async function ownsDocument(documentId, userId) {
  const result = await pool.query(
    'SELECT id FROM documents WHERE id = $1 AND user_id = $2',
    [documentId, userId]
  );
  return Boolean(result.rows[0]);
}

async function activeLink(documentId) {
  const result = await pool.query(
    'SELECT token, created_at FROM shared_links WHERE document_id = $1 AND revoked_at IS NULL',
    [documentId]
  );
  return result.rows[0] || null;
}

// lihat tautan aktif sebuah dokumen (null kalau belum ada)
router.get(
  '/:id/share',
  handle(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: 'ID tidak valid' });
    if (!(await ownsDocument(id, req.user.id))) {
      return res.status(404).json({ message: 'Dokumen tidak ditemukan' });
    }
    res.json({ link: await activeLink(id) });
  })
);

// buat tautan berbagi (kalau sudah ada yang aktif, kirim yang itu)
router.post(
  '/:id/share',
  requireGuru,
  handle(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: 'ID tidak valid' });
    if (!(await ownsDocument(id, req.user.id))) {
      return res.status(404).json({ message: 'Dokumen tidak ditemukan' });
    }

    const token = crypto.randomBytes(16).toString('base64url');
    const inserted = await pool.query(
      `INSERT INTO shared_links (document_id, token)
       VALUES ($1, $2)
       ON CONFLICT (document_id) WHERE revoked_at IS NULL DO NOTHING
       RETURNING token, created_at`,
      [id, token]
    );
    if (inserted.rows[0]) {
      return res.status(201).json({ link: inserted.rows[0] });
    }
    res.json({ link: await activeLink(id) });
  })
);

// cabut tautan aktif
router.delete(
  '/:id/share',
  handle(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: 'ID tidak valid' });
    if (!(await ownsDocument(id, req.user.id))) {
      return res.status(404).json({ message: 'Dokumen tidak ditemukan' });
    }

    const result = await pool.query(
      `UPDATE shared_links SET revoked_at = NOW()
       WHERE document_id = $1 AND revoked_at IS NULL
       RETURNING id`,
      [id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Tidak ada tautan aktif' });
    }
    res.json({ message: 'Tautan dicabut' });
  })
);

export default router;
CREATE TABLE shared_links (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  token VARCHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

-- satu dokumen hanya boleh punya satu tautan aktif
CREATE UNIQUE INDEX one_active_link_per_document
  ON shared_links (document_id)
  WHERE revoked_at IS NULL;
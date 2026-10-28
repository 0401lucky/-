-- +goose Up
CREATE TABLE IF NOT EXISTS oidc_config (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  settings JSONB NOT NULL,
  encrypted_client_secret TEXT NOT NULL DEFAULT '',
  revision TEXT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS oidc_identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject)
);

CREATE INDEX IF NOT EXISTS idx_oidc_identities_user ON oidc_identities(user_id);

-- +goose Down
DROP TABLE IF EXISTS oidc_identities;
DROP TABLE IF EXISTS oidc_config;

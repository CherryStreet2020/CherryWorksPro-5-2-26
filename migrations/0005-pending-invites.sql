DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invite_status') THEN
    CREATE TYPE invite_status AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pending_invites (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id VARCHAR(36) NOT NULL REFERENCES orgs(id),
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255),
  role user_role NOT NULL DEFAULT 'TEAM_MEMBER',
  invited_by_user_id VARCHAR(36) NOT NULL REFERENCES users(id),
  invite_token VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  status invite_status NOT NULL DEFAULT 'PENDING',
  last_resent_at TIMESTAMP,
  resend_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS pending_invites_org_idx ON pending_invites (org_id);
CREATE INDEX IF NOT EXISTS pending_invites_token_idx ON pending_invites (invite_token);
CREATE INDEX IF NOT EXISTS pending_invites_email_org_idx ON pending_invites (email, org_id);

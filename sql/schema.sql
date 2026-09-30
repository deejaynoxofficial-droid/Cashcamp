-- Cash Camp v2 PostgreSQL schema

CREATE TABLE IF NOT EXISTS users (
 id BIGSERIAL PRIMARY KEY,
 name VARCHAR(120) NOT NULL,
 email VARCHAR(255) UNIQUE NOT NULL,
 phone VARCHAR(40) UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 referral_code VARCHAR(20) UNIQUE NOT NULL,
 referred_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
 status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended')),
 email_verified_at TIMESTAMPTZ,
 phone_verified_at TIMESTAMPTZ,
 balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
 risk_score INT NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
 last_login_at TIMESTAMPTZ,
 last_login_ip INET,
 signup_ip INET,
 signup_user_agent_hash CHAR(64),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_tokens (
 id BIGSERIAL PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL,
 token_type VARCHAR(30) NOT NULL CHECK (token_type IN ('email_verify','password_reset')),
 expires_at TIMESTAMPTZ NOT NULL,
 used_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS auth_tokens_lookup ON auth_tokens(token_hash, token_type);

CREATE TABLE IF NOT EXISTS deposits (
 id BIGSERIAL PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 amount BIGINT NOT NULL CHECK (amount > 0),
 currency VARCHAR(8) NOT NULL DEFAULT 'UGX',
 payment_number VARCHAR(40) NOT NULL,
 transaction_ref VARCHAR(120) NOT NULL,
 provider_ref VARCHAR(160),
 provider VARCHAR(40) NOT NULL DEFAULT 'manual',
 checkout_url TEXT,
 proof BYTEA,
 proof_mime VARCHAR(80),
 status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('created','pending','processing','approved','rejected','failed','expired')),
 reviewed_by BIGINT REFERENCES users(id),
 reviewed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS deposits_transaction_ref_unique ON deposits(transaction_ref);
CREATE UNIQUE INDEX IF NOT EXISTS deposits_provider_ref_unique ON deposits(provider_ref) WHERE provider_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_events (
 id BIGSERIAL PRIMARY KEY,
 provider VARCHAR(40) NOT NULL,
 event_id VARCHAR(160) NOT NULL,
 event_type VARCHAR(80),
 payload JSONB NOT NULL,
 signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
 processed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_events_provider_event_unique ON payment_events(provider,event_id);

CREATE TABLE IF NOT EXISTS tasks (
 id BIGSERIAL PRIMARY KEY,
 title VARCHAR(160) NOT NULL,
 description TEXT,
 task_type VARCHAR(30) NOT NULL DEFAULT 'ad',
 url TEXT,
 reward BIGINT NOT NULL CHECK (reward > 0),
 duration_seconds INT NOT NULL DEFAULT 15 CHECK (duration_seconds BETWEEN 5 AND 3600),
 daily_limit INT NOT NULL DEFAULT 1 CHECK (daily_limit > 0),
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_sessions (
 id UUID PRIMARY KEY,
 task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ NOT NULL,
 completed_at TIMESTAMPTZ,
 ip INET,
 user_agent_hash CHAR(64),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS task_sessions_user_idx ON task_sessions(user_id,task_id,created_at);

CREATE TABLE IF NOT EXISTS task_completions (
 id BIGSERIAL PRIMARY KEY,
 task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_id UUID UNIQUE REFERENCES task_sessions(id),
 reward BIGINT NOT NULL CHECK (reward > 0),
 status VARCHAR(20) NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS task_completion_day_idx ON task_completions(task_id,user_id,created_at);

CREATE TABLE IF NOT EXISTS withdrawals (
 id BIGSERIAL PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 amount BIGINT NOT NULL CHECK (amount > 0),
 phone VARCHAR(40) NOT NULL,
 status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','paid','rejected','failed','refunded')),
 provider_ref VARCHAR(160),
 admin_note TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 reviewed_at TIMESTAMPTZ,
 reviewed_by BIGINT REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_provider_ref_unique ON withdrawals(provider_ref) WHERE provider_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS wallet_transactions (
 id BIGSERIAL PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 type VARCHAR(40) NOT NULL,
 amount BIGINT NOT NULL,
 balance_after BIGINT NOT NULL,
 reference VARCHAR(160) NOT NULL,
 description TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referrals (
 id BIGSERIAL PRIMARY KEY,
 referrer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 referred_user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 bonus BIGINT NOT NULL,
 status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','paid')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 approved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_logs (
 id BIGSERIAL PRIMARY KEY,
 actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 action VARCHAR(100) NOT NULL,
 target_type VARCHAR(60),
 target_id VARCHAR(160),
 ip INET,
 user_agent_hash CHAR(64),
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_logs_target_idx ON audit_logs(target_type,target_id,created_at);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs(actor_user_id,created_at);

CREATE TABLE IF NOT EXISTS fraud_events (
 id BIGSERIAL PRIMARY KEY,
 user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 event_type VARCHAR(80) NOT NULL,
 severity INT NOT NULL DEFAULT 1 CHECK (severity BETWEEN 1 AND 100),
 ip INET,
 user_agent_hash CHAR(64),
 details JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
 key VARCHAR(80) PRIMARY KEY,
 value TEXT NOT NULL
);

-- Compatibility upgrades for older Cash Camp databases.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS risk_score INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip INET;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip INET;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_user_agent_hash CHAR(64);

ALTER TABLE deposits ADD COLUMN IF NOT EXISTS currency VARCHAR(8) NOT NULL DEFAULT 'UGX';
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS provider_ref VARCHAR(160);
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS provider VARCHAR(40) NOT NULL DEFAULT 'manual';
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS checkout_url TEXT;
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS provider_ref VARCHAR(160);
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS reference VARCHAR(160);

-- Repair legacy duplicate wallet references before enforcing uniqueness.
WITH duplicates AS (
 SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id,reference ORDER BY id) AS rn
 FROM wallet_transactions
 WHERE reference IS NOT NULL
)
UPDATE wallet_transactions w
SET reference = CONCAT('LEGACY-',w.id)
FROM duplicates d
WHERE d.id=w.id AND d.rn>1;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_reference_unique ON wallet_transactions(user_id,reference);

ALTER TABLE withdrawals DROP CONSTRAINT IF EXISTS withdrawals_status_check;
ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_status_check
CHECK (status IN ('pending','processing','paid','rejected','failed','refunded'));

INSERT INTO settings (key,value) VALUES
 ('activation_fee','11000'),
 ('referral_bonus','1000'),
 ('min_withdrawal','5000'),
 ('payment_number','+256745720308'),
 ('payment_name','FATUMAH SULEIMAN'),
 ('currency','UGX')
ON CONFLICT (key) DO NOTHING;

INSERT INTO tasks (title,description,task_type,url,reward,duration_seconds,daily_limit)
SELECT 'Welcome Ad','Complete this demo advertisement task.','ad','https://example.com',100,15,1
WHERE NOT EXISTS (SELECT 1 FROM tasks);

UPDATE users
SET email_verified_at=created_at
WHERE email_verified_at IS NULL AND role='admin';

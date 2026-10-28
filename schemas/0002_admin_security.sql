-- ====================================================================
-- CARINA Enterprise Admin Authentication & Session Management Schema
-- Target Database: odoo-report-db-ksa
-- ====================================================================

CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    display_name TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME
);

CREATE TABLE IF NOT EXISTS admin_sessions (
    session_id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

-- Seed Initial Super-Admin Account:
-- Email: admin@carinawear.com
-- Initial Password: CarinaAdmin2026!
INSERT OR REPLACE INTO admin_users (id, email, password_hash, salt, display_name, is_active)
VALUES (
    'ADMIN_PRIMARY',
    'admin@carinawear.com',
    '1344d68c8f6a4a623dcf3b77f1a297da204b4272949cd87a5ef319c8ea00825e',
    'e8adbc9e7e8f7bde826fbcb68c762e47',
    'CARINA Commercial Strategist',
    1
);

-- ====================================================================
-- CARINA Style Lifecycle Monitor & Strategic Discount Planner
-- Auxiliary System Tables for Dynamic Governance & Caching
-- Target Database: odoo-report-db-ksa
-- ====================================================================

-- 1. Dynamic Business Rules Ledger (No-Code & Pluggable Policy Enforcement)
CREATE TABLE IF NOT EXISTS business_rules (
    rule_id TEXT PRIMARY KEY,
    rule_name TEXT NOT NULL,
    rule_category TEXT NOT NULL,       -- 'MARGIN', 'DISCOUNT_CAP', 'EXCLUSION', 'STOCK_TARGET'
    target_scope TEXT NOT NULL,        -- 'GLOBAL', 'CATEGORY:Bra', 'STYLE:50003', 'STORE:Jouri'
    condition_operator TEXT NOT NULL,  -- 'MIN', 'MAX', 'EQUALS', 'EXCLUDE'
    rule_value TEXT NOT NULL,          -- e.g. '45.0', 'AW26', '20.0'
    enforcement_level TEXT NOT NULL,   -- 'HARD_BLOCK' (Cannot violate) or 'WARNING'
    is_active INTEGER DEFAULT 1,       -- 1 = Active, 0 = Paused
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Pre-Aggregated Style Master Snapshot (Enables sub-10ms UI Loading)
CREATE TABLE IF NOT EXISTS style_plan_snapshots (
    style_code TEXT PRIMARY KEY,
    product_name TEXT NOT NULL,
    category TEXT,
    season TEXT,
    total_physical_stock INTEGER,
    stock_andalus INTEGER,
    stock_yasmeen INTEGER,
    stock_jouri INTEGER,
    stock_wh INTEGER,
    cumulative_str_pct REAL,
    weekly_ros REAL,
    sar_curve_health TEXT,
    unit_cost REAL,
    cost_plus_vat REAL,
    ticket_price REAL,
    recommended_offer TEXT,
    promotional_price REAL,
    discount_pct REAL,
    zero_loss_status TEXT,
    forecast_sold INTEGER,
    forecast_profit REAL,
    post_event_stock INTEGER,
    commercial_rationale TEXT,
    last_computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    weekly_ros_2wk REAL,
    weekly_ros_4wk REAL,
    momentum_ratio REAL,
    active_weeks REAL,
    momentum_label TEXT,
    sold_units INTEGER DEFAULT 0,
    sales_lifecycle_weeks REAL DEFAULT 0.0,
    lifecycle_tier TEXT,
    store_floor_wos REAL DEFAULT 0.0,
    active_size_count INTEGER DEFAULT 0,
    has_core_sizes INTEGER DEFAULT 1,
    is_single_size INTEGER DEFAULT 0,
    is_manual_override INTEGER DEFAULT 0,
    size_breakdown_json TEXT,
    first_move_date TEXT
);

-- 3. Post-Campaign Daily Sales Monitoring & Lift Tracker
CREATE TABLE IF NOT EXISTS post_promo_monitoring (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    style_code TEXT NOT NULL,
    audit_date DATE NOT NULL,
    units_sold_today INTEGER DEFAULT 0,
    cumulative_sold_post_launch INTEGER DEFAULT 0,
    pre_promo_baseline_ros REAL,
    observed_lift_multiplier REAL,
    alert_status TEXT DEFAULT 'NORMAL', -- 'NORMAL', 'PROMO_STALL', 'EARLY_SELLOUT'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Governance Audit Log
CREATE TABLE IF NOT EXISTS plan_audit_log (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_type TEXT NOT NULL,         -- 'RULE_CREATED', 'RULE_MODIFIED', 'PLAN_EXPORTED'
    actor TEXT NOT NULL,               -- 'USER', 'COPILOT_AI', 'SYSTEM_SYNC'
    details TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. AI Continuous Retraining & LoRA Configuration
CREATE TABLE IF NOT EXISTS ai_retraining_settings (
    id TEXT PRIMARY KEY,
    retraining_period TEXT DEFAULT 'weekly', -- 'daily', 'weekly', 'biweekly', 'monthly', 'manual'
    auto_enabled INTEGER DEFAULT 1,
    active_lora_adapter TEXT DEFAULT 'carina-retail-v1',
    last_trained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    next_scheduled_at DATETIME DEFAULT (datetime('now', '+7 days')),
    dataset_sample_count INTEGER DEFAULT 0,
    benchmark_accuracy REAL DEFAULT 100.0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. Merchandiser Feedback & Alignment Ledger (RLHF / DPO Preference Signal)
CREATE TABLE IF NOT EXISTS copilot_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_query TEXT NOT NULL,
    style_code TEXT,
    model_used TEXT,
    response_text TEXT,
    rating INTEGER, -- 1 = Upvote, -1 = Downvote
    override_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. Enterprise Admin Authentication & Session Security
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

-- ====================================================================
-- 8. System Settings (Active Campaign Mode: Regular 2-Month Drop vs. Commercial Event)
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO system_settings (key, value)
VALUES ('ACTIVE_CAMPAIGN_MODE', 'REGULAR_DROP_CYCLE');

-- Initial Seed Governance Policies & Initial Super-Admin
-- ====================================================================

INSERT OR REPLACE INTO business_rules (rule_id, rule_name, rule_category, target_scope, condition_operator, rule_value, enforcement_level, is_active)
VALUES 
('RULE_ZERO_LOSS_VAT', 'Saudi 15% VAT Zero-Loss Floor', 'MARGIN', 'GLOBAL', 'MIN', '0.0', 'HARD_BLOCK', 1),
('RULE_EXCLUDE_AW26', 'Fresh Winter 2026 Exclusion', 'EXCLUSION', 'SEASON:AW26', 'EXCLUDE', '1', 'HARD_BLOCK', 1),
('RULE_CAP_NOOS_DISCOUNT', 'Continuity Basic Discount Cap', 'DISCOUNT_CAP', 'SEASON:All Season 2018', 'MAX', '25.0', 'HARD_BLOCK', 1),
('RULE_MIN_NET_MARGIN', 'Portfolio Net Margin Target Floor', 'MARGIN', 'GLOBAL', 'MIN', '45.0', 'WARNING', 1),
('RULE_DECONGEST_JOURI', 'Taif Jouri Density Target', 'STOCK_TARGET', 'STORE:Jouri', 'MAX', '36.0', 'WARNING', 1),
('RULE_DECONGEST_YASMEEN', 'Jeddah Yasmeen Density Target', 'STOCK_TARGET', 'STORE:Yasmeen', 'MAX', '35.0', 'WARNING', 1);

INSERT OR IGNORE INTO ai_retraining_settings (
    id, retraining_period, auto_enabled, active_lora_adapter, 
    last_trained_at, next_scheduled_at, dataset_sample_count, benchmark_accuracy
) VALUES (
    'GLOBAL', 'weekly', 1, 'carina-retail-v1',
    CURRENT_TIMESTAMP, datetime('now', '+7 days'), 0, 100.0
);

INSERT OR REPLACE INTO admin_users (id, email, password_hash, salt, display_name, is_active)
VALUES (
    'ADMIN_PRIMARY',
    'admin@carinawear.com',
    '1344d68c8f6a4a623dcf3b77f1a297da204b4272949cd87a5ef319c8ea00825e',
    'e8adbc9e7e8f7bde826fbcb68c762e47',
    'CARINA Commercial Strategist',
    1
);

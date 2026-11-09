-- ====================================================================
-- CARINA AI Retraining Governance & Merchandiser Feedback Schema
-- Target Database: odoo-report-db-ksa
-- ====================================================================

-- 1. AI Continuous Retraining & LoRA Configuration
CREATE TABLE IF NOT EXISTS ai_retraining_settings (
    id TEXT PRIMARY KEY,
    retraining_period TEXT DEFAULT 'weekly', -- 'daily', 'weekly', 'biweekly', 'monthly', 'manual'
    auto_enabled INTEGER DEFAULT 1,
    active_lora_adapter TEXT DEFAULT 'carina-retail-v1',
    last_trained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    next_scheduled_at DATETIME DEFAULT (datetime('now', '+7 days')),
    dataset_sample_count INTEGER DEFAULT 1493,
    benchmark_accuracy REAL DEFAULT 100.0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed initial configuration
INSERT OR IGNORE INTO ai_retraining_settings (
    id, retraining_period, auto_enabled, active_lora_adapter, 
    last_trained_at, next_scheduled_at, dataset_sample_count, benchmark_accuracy
) VALUES (
    'GLOBAL', 'weekly', 1, 'carina-retail-v1',
    CURRENT_TIMESTAMP, datetime('now', '+7 days'), 1493, 100.0
);

-- 2. Merchandiser Feedback & Alignment Ledger (RLHF / DPO Preference Signal)
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

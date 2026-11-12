const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { parseSimpleYaml } = require('../scripts/compile_ontology');

function createTsLoader() {
  const cache = new Map();
  const rootDir = path.resolve(__dirname, '..');

  function loadTs(relPath) {
    const absPath = path.resolve(rootDir, relPath.endsWith('.ts') ? relPath : `${relPath}.ts`);
    if (cache.has(absPath)) return cache.get(absPath).exports;

    const source = fs.readFileSync(absPath, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      },
      fileName: absPath
    });

    const mod = new Module(absPath);
    cache.set(absPath, mod);
    mod.filename = absPath;
    mod.paths = Module._nodeModulePaths(path.dirname(absPath));

    const origRequire = mod.require.bind(mod);
    mod.require = (id) => {
      if (id.startsWith('.')) {
        const resolved = path.resolve(path.dirname(absPath), id);
        if (fs.existsSync(`${resolved}.ts`)) {
          return loadTs(path.relative(rootDir, `${resolved}.ts`));
        }
      }
      return origRequire(id);
    };

    mod._compile(outputText, absPath);
    return mod.exports;
  }

  return loadTs;
}

describe('CARINA Certified Semantic Ontology & Guarded Text-to-SQL Layer', () => {
  const loader = createTsLoader();
  const retriever = loader('src/ai/ontology/semanticRetriever.ts');
  const sqlGuard = loader('src/ai/ontology/sqlGuard.ts');
  const runner = loader('src/ai/ontology/analyticalRunner.ts');
  const copilot = loader('src/ai/copilot.ts');

  test('Ossie YAML seed parses cleanly with governance boundaries and certified terms', () => {
    const yamlText = fs.readFileSync(path.join(__dirname, '../ontology/carina_ossie_seed.yaml'), 'utf8');
    const model = parseSimpleYaml(yamlText);
    assert.equal(model.version, '1.0.0');
    assert.ok(model.governance.blockedTables.includes('admin_users'));
    assert.ok(model.governance.blockedTables.includes('admin_sessions'));
    assert.ok(model.governance.excludedLocations.includes('Shofy/Stock'));
    assert.ok(model.terms.length >= 15);
    assert.ok(model.sqlAttributes.length >= 4);
  });

  test('checkAnswerable blocks unguided metrics in Strict SSOT mode and allows them in Exploratory mode', () => {
    const blocked = retriever.checkAnswerable('What is our customer return rate by store?', false);
    assert.equal(blocked.answerable, false);
    assert.ok(blocked.blockedMetricLabels.includes('Customer Return Rate'));

    const allowedExploratory = retriever.checkAnswerable('What is our customer return rate by store?', true);
    assert.equal(allowedExploratory.answerable, true);

    const validRetail = retriever.checkAnswerable('Which pyjamas in Taif Jouri Mall have high WOS?', false);
    assert.equal(validRetail.answerable, true);
    assert.ok(validRetail.matchedTermIds.includes('jouri_stock'));
    assert.ok(validRetail.matchedTermIds.includes('store_floor_wos'));
  });

  test('retrieveOntologyContext maps domain synonyms and isAnalyticalDataQuery distinguishes ad-hoc queries', () => {
    const ctx = retriever.retrieveOntologyContext('How much COGS capital is tied up in broken curve Bras?', 6);
    const ids = ctx.matchedTerms.map(t => t.id);
    assert.ok(ids.includes('capital_tied_up'));
    assert.ok(ids.includes('size_curve_health'));
    assert.ok(ctx.promptBlock.includes('style_plan_snapshots'));

    assert.equal(retriever.isAnalyticalDataQuery('Top 10 pyjamas in Jouri Mall with >30 WOS'), true);
    assert.equal(retriever.isAnalyticalDataQuery('Compare total capital tied up by category'), true);
    assert.equal(retriever.isAnalyticalDataQuery('what is the vat floor'), false);
  });

  test('sqlGuard rejects mutations, sensitive tables, comments, stacked SQL, and enforces LIMIT', () => {
    const blockedCases = [
      'DELETE FROM style_plan_snapshots',
      'DROP TABLE business_rules',
      'PRAGMA table_info(style_plan_snapshots)',
      'SELECT * FROM admin_users',
      'SELECT * FROM admin_sessions LIMIT 5',
      'SELECT style_code FROM style_plan_snapshots; DROP TABLE style_plan_snapshots',
      'SELECT style_code FROM style_plan_snapshots -- comment',
      'SELECT * FROM unknown_secret_table'
    ];
    for (const sql of blockedCases) {
      const res = sqlGuard.validateReadOnlySql(sql);
      assert.equal(res.valid, false, `Expected SQL to be blocked: ${sql}`);
    }

    const okNoLimit = sqlGuard.validateReadOnlySql('SELECT style_code, weekly_ros FROM style_plan_snapshots ORDER BY weekly_ros DESC');
    assert.equal(okNoLimit.valid, true);
    assert.ok(okNoLimit.sanitizedSql.endsWith('LIMIT 25'));

    const okClamped = sqlGuard.validateReadOnlySql('SELECT style_code FROM style_plan_snapshots LIMIT 999');
    assert.equal(okClamped.valid, true);
    assert.ok(okClamped.sanitizedSql.endsWith('LIMIT 50'));

    const okOffset = sqlGuard.validateReadOnlySql('SELECT style_code FROM style_plan_snapshots LIMIT 10 OFFSET 5');
    assert.equal(okOffset.valid, true);
    assert.equal(okOffset.sanitizedSql, 'SELECT style_code FROM style_plan_snapshots LIMIT 10 OFFSET 5');

    const okCte = sqlGuard.validateReadOnlySql(
      'WITH top_cat AS (SELECT category, SUM(total_physical_stock) AS u FROM style_plan_snapshots GROUP BY category) SELECT * FROM top_cat LIMIT 10'
    );
    assert.equal(okCte.valid, true);
  });

  test('extractSqlFromModelOutput parses JSON payloads and fenced SQL blocks', () => {
    const fromJson = sqlGuard.extractSqlFromModelOutput(
      'Here is the plan:\n{"sql":"SELECT style_code FROM style_plan_snapshots LIMIT 5","summaryTitle":"Top 5","formulaUsed":"weekly_ros"}'
    );
    assert.equal(fromJson.sql, 'SELECT style_code FROM style_plan_snapshots LIMIT 5');
    assert.equal(fromJson.title, 'Top 5');

    const fromFence = sqlGuard.extractSqlFromModelOutput('```sql\nSELECT COUNT(*) FROM business_rules\n```');
    assert.equal(fromFence.sql, 'SELECT COUNT(*) FROM business_rules');
  });

  test('End-to-end Copilot executes guarded LLM SQL against mock D1 and falls back safely when LLM emits unsafe SQL', async () => {
    const executedQueries = [];
    const mockDb = {
      prepare(sql) {
        executedQueries.push(sql);
        const makeResult = () => ({
          async all() {
            if (sql.includes('style_plan_snapshots')) {
              return {
                results: [
                  {
                    style_code: '58424',
                    product_name: 'Pyjama Set AW25-PJ',
                    category: 'Pyjamas',
                    stock_jouri: 38,
                    store_floor_wos: 42.5,
                    recommended_offer: 'Take 3 For 99 SAR'
                  }
                ]
              };
            }
            return { results: [] };
          },
          async first() {
            return { style_cnt: 18, unit_cnt: 740, capital_sar: 19400 };
          }
        });
        return {
          bind() {
            return makeResult();
          },
          ...makeResult()
        };
      }
    };

    // Case 1: Safe LLM JSON SQL
    const safeAi = {
      async run() {
        return {
          response: JSON.stringify({
            sql: 'SELECT style_code, product_name, stock_jouri, store_floor_wos, recommended_offer FROM style_plan_snapshots WHERE stock_jouri > 0 ORDER BY store_floor_wos DESC LIMIT 5',
            summaryTitle: 'Jouri Mall Top Runway Bottlenecks',
            formulaUsed: 'store_floor_wos DESC WHERE stock_jouri > 0'
          })
        };
      }
    };

    const resSafe = await copilot.handleCopilotChat(
      { DB: mockDb, AI: safeAi },
      { message: 'Which pyjama styles in Jouri Mall have the highest WOS?' }
    );
    assert.ok(resSafe.reply.includes('Jouri Mall Top Runway Bottlenecks'));
    assert.ok(resSafe.reply.includes('58424'));
    assert.ok(resSafe.reply.includes('42.5'));
    assert.ok(!resSafe.reply.includes('42.50 SAR'), 'store_floor_wos must NOT be formatted as SAR currency');
    assert.ok(resSafe.reply.includes('Certified Ontology Terms'));
    assert.ok(executedQueries.some(q => q.includes('stock_jouri > 0')));

    // Case 2: Malicious/unsafe LLM SQL gets blocked and falls back to certified SQL template
    const unsafeAi = {
      async run() {
        return {
          response: JSON.stringify({
            sql: 'SELECT email, password_hash FROM admin_users LIMIT 10',
            summaryTitle: 'Admin Leak'
          })
        };
      }
    };

    const resGuarded = await copilot.handleCopilotChat(
      { DB: mockDb, AI: unsafeAi },
      { message: 'Which pyjama styles in Jouri Mall have the highest WOS?' }
    );
    assert.ok(!executedQueries.some(q => q.includes('admin_users')), 'admin_users must NEVER execute on D1');
    assert.ok(resGuarded.reply.includes('Top Runway Bottleneck Styles at Jouri Mall (Taif)'));
    assert.ok(resGuarded.reply.includes('58424'));

    // Case 3: RULE_COMPILER includes Live D1 Impact Preview
    const resRule = await copilot.handleCopilotChat(
      { DB: mockDb, AI: safeAi },
      { mode: 'RULE_COMPILER', message: 'Cap discounts on all bras at 20%' }
    );
    assert.ok(resRule.reply.includes('Live D1 Impact Preview'));
    assert.ok(resRule.reply.includes('18 styles'));
    assert.ok(resRule.reply.includes('[APPLY_RULE:'));
  });

  test('Regression: Follow-ups on focused style preserve contextStyleCode and survive DeepSeek R1 empty <think> responses', async () => {
    const style59465 = {
      style_code: '59465',
      product_name: 'Body splash Secret Desire 100ML',
      category: 'Cosmetics',
      season: 'Continuity',
      total_physical_stock: 180,
      stock_andalus: 60,
      stock_yasmeen: 70,
      stock_jouri: 30,
      stock_wh: 20,
      cumulative_str_pct: 64.0,
      weekly_ros: 4.0,
      sar_curve_health: 'Single Size (Complete)',
      unit_cost: 12.0,
      cost_plus_vat: 13.8,
      ticket_price: 55.0,
      recommended_offer: 'Full Price Margin Protection (0% Off)',
      promotional_price: 55.0,
      discount_pct: 0,
      zero_loss_status: 'ZERO_LOSS_COMPLIANT',
      forecast_sold: 40,
      forecast_profit: 1433,
      commercial_rationale: 'High margin continuity fragrance.',
      is_single_size: 1,
      has_core_sizes: 1
    };

    const mockDb = {
      prepare(sql) {
        const makeResult = () => ({
          async all() {
            if (sql.includes('style_code = ?')) {
              return { results: [style59465] };
            }
            return { results: [] };
          },
          async first() {
            return null;
          }
        });
        return {
          bind() {
            return makeResult();
          },
          ...makeResult()
        };
      }
    };

    let capturedDeepSeekMaxTokens = 0;
    const aiWithDeepSeekThinkThenFallback = {
      async run(modelId, payload) {
        if (modelId.includes('deepseek-r1')) {
          capturedDeepSeekMaxTokens = payload.max_tokens;
          // Simulate DeepSeek R1 getting cut off inside <think>
          return { response: '<think>Let me analyze style 59465 velocity and margin...' };
        }
        return {
          response:
            '### Commercial Decision Analysis — Style **59465** (*Body splash Secret Desire 100ML*)\n\n' +
            '• **Why This Decision Applies:** With 4.0 u/wk velocity and 78.2% IMU, use checkout basket-builder bundles (Spend 250 Save 50) instead of a solo markdown.\n' +
            '• **Active Offer & Margin Protection:** Full Price Margin Protection (0% Off) at 55.00 SAR.'
        };
      }
    };

    // 1. Follow-up: "okay, if i want to increase sales for this item what should i do?"
    const res1 = await copilot.handleCopilotChat(
      { DB: mockDb, AI: aiWithDeepSeekThinkThenFallback },
      {
        message: 'okay, if i want to increase sales for this item what should i do?',
        contextStyleCode: '59465',
        model: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'
      }
    );
    assert.equal(res1.activeStyleCode, '59465');
    assert.ok(capturedDeepSeekMaxTokens >= 1400, 'DeepSeek R1 must receive >= 1400 max_tokens');
    assert.ok(res1.reply && res1.reply.length > 40, 'Must never return empty reply on 200');
    assert.ok(res1.reply.includes('59465'));

    // 2. Follow-up: "i mean it for this item, what offer would fit instead of 0%"
    const res2 = await copilot.handleCopilotChat(
      { DB: mockDb, AI: aiWithDeepSeekThinkThenFallback },
      {
        message: 'i mean it for this item, what offer would fit instead of 0%',
        contextStyleCode: '59465',
        model: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'
      }
    );
    assert.equal(res2.activeStyleCode, '59465');
    assert.ok(res2.reply.includes('59465'));
    assert.ok(res2.reply.includes('Alternative Promotional Scenarios'));

    // 3. General query with DeepSeek R1 returning ONLY unclosed <think> must fall back and never return empty reply
    const res3 = await copilot.handleCopilotChat(
      { DB: mockDb, AI: aiWithDeepSeekThinkThenFallback },
      {
        message: 'How should we balance Jeddah vs Taif stock ahead of payday?',
        model: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'
      }
    );
    assert.ok(res3.reply && res3.reply.trim().length >= 25, 'General DeepSeek fallback must never return empty reply');

    // 4. Natural classification question "is it slow of med or fast?" on focused style 59465
    // must NOT dump bare formatFullStyleCard; it must inject speed_band_classification ontology & answer directly
    let capturedStyleUserPrompt = '';
    const capturingAi = {
      async run(_modelId, payload) {
        capturedStyleUserPrompt = payload.messages[1].content;
        return {
          response:
            '### Commercial Decision Analysis — Style **59465** (*Body splash Secret Desire 100ML*)\n\n' +
            '• **Direct Answer:** Style **59465** is classified as **FAST** (`FAST_HERO`) — selling at **4 u/wk** (well above the >= 1.5 u/wk single-size fast threshold) with **13.8 WOS** store-floor runway.'
        };
      }
    };

    const res4 = await copilot.handleCopilotChat(
      { DB: mockDb, AI: capturingAi },
      {
        message: 'is it slow of med or fast?',
        contextStyleCode: '59465'
      }
    );
    assert.equal(res4.activeStyleCode, '59465');
    assert.ok(capturedStyleUserPrompt.includes('speed_band_classification'), 'Style Case C must inject speed_band_classification ontology term');
    assert.ok(capturedStyleUserPrompt.includes('FAST_HERO'), 'Style Case C must inject evaluated FAST_HERO speedBand');
    assert.ok(res4.reply.includes('Direct Answer') && res4.reply.includes('FAST'), 'Reply must directly answer Fast/Med/Slow');
    assert.ok(!res4.reply.includes('Total Physical Inventory:'), 'Must not fall back to bare full style card dump');

    // Deterministic fallback for same natural question must also answer Speed Classification directly
    const res4Fallback = await copilot.handleCopilotChat(
      { DB: mockDb },
      {
        message: 'is it slow of med or fast?',
        contextStyleCode: '59465'
      }
    );
    assert.equal(res4Fallback.activeStyleCode, '59465');
    assert.ok(res4Fallback.reply.includes('Speed Classification') && res4Fallback.reply.includes('FAST'), 'Deterministic fallback must lead with Speed Classification');

    // 5. Typo-tolerant conversational alternative offer query "do you recommend antoher offer?"
    // must NOT fall back to static 0% Executive Offer Decision Dossier; must pass history + pre-computed alternatives to AI
    let capturedAltMessages = [];
    const capturingAltAi = {
      async run(_modelId, payload) {
        capturedAltMessages = payload.messages;
        return {
          response:
            '### Commercial Decision Analysis — Style **59465** (*Body splash Secret Desire 100ML*)\n\n' +
            '• **Recommendation Verdict:** Keep **0%** at store doors (13.8 WOS) or switch to **Spend 250 Save 50** (~48.00 SAR/u net margin ~64%) to pull through the **320 units** in Central WH.'
        };
      }
    };

    const res5 = await copilot.handleCopilotChat(
      { DB: mockDb, AI: capturingAltAi },
      {
        message: 'do you recommend antoher offer?',
        contextStyleCode: '59465',
        history: [
          { role: 'user', content: 'why 0%' },
          { role: 'assistant', content: 'Protected because door WOS is 13.8 weeks at 4 u/wk.' }
        ]
      }
    );
    assert.equal(res5.activeStyleCode, '59465');
    assert.ok(!res5.reply.includes('Executive Offer Decision Dossier'), 'Must never dump static 0% dossier when asking for another offer');
    assert.ok(capturedAltMessages.length >= 4, 'Multi-turn history must be passed to AI');
    const lastUserMsg5 = capturedAltMessages[capturedAltMessages.length - 1].content;
    assert.ok(lastUserMsg5.includes('Pre-Computed VAT-Compliant Alternative Offer Options'), 'Must pass computed alternatives into AI');
    assert.ok(res5.reply.includes('Recommendation Verdict') && res5.reply.includes('Alternative Promotional Scenarios'), 'Must return AI recommendation plus comparison scenarios');

    // 6. Transfer question while focused on Style 59465 stays scoped to 59465 rather than dumping portfolio transfer table
    const res6 = await copilot.handleCopilotChat(
      { DB: mockDb, AI: capturingAltAi },
      {
        message: 'does it need a stock transfer between branches?',
        contextStyleCode: '59465'
      }
    );
    assert.equal(res6.activeStyleCode, '59465');
    assert.ok(!res6.reply.includes('Inter-Store Stock Balancing'), 'Single-style transfer question must stay focused on 59465');
  });
});

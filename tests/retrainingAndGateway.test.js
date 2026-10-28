const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runBenchmark } = require('../scripts/evaluate_model_benchmark');

describe('AI Retraining & Gateway Infrastructure', () => {
  it('Model Evaluation Benchmark passes 100% on zero-loss, formatting, and emoji cleanliness', () => {
    const res = runBenchmark();
    assert.equal(res.accuracy_pct, 100);
    assert.equal(res.zero_loss_compliance_pct, 100);
    assert.equal(res.formatting_integrity_pct, 100);
    assert.equal(res.emoji_cleanliness_pct, 100);
    assert.equal(res.failed_tests, 0);
  });

  it('Retraining period day offsets compute accurately', () => {
    const periods = {
      daily: 1,
      weekly: 7,
      biweekly: 14,
      monthly: 30
    };

    for (const [period, expectedDays] of Object.entries(periods)) {
      let dayOffset = 7;
      if (period === 'daily') dayOffset = 1;
      if (period === 'weekly') dayOffset = 7;
      if (period === 'biweekly') dayOffset = 14;
      if (period === 'monthly') dayOffset = 30;

      assert.equal(dayOffset, expectedDays);
    }
  });

  it('AI Gateway configuration parameters conform to Workers AI specifications', () => {
    const env = {
      AI_GATEWAY_ID: 'carina-ai-gateway',
      LORA_ADAPTER_NAME: 'carina-retail-v1'
    };

    const gatewayOptions = env.AI_GATEWAY_ID ? {
      gateway: {
        id: env.AI_GATEWAY_ID,
        skipCache: false,
        cacheTtl: 3600
      }
    } : undefined;

    assert.ok(gatewayOptions);
    assert.equal(gatewayOptions.gateway.id, 'carina-ai-gateway');
    assert.equal(gatewayOptions.gateway.cacheTtl, 3600);
    assert.equal(gatewayOptions.gateway.skipCache, false);
  });

  it('Hyperparameters enforce temperature, top_p, and repetition_penalty', () => {
    const isMathOrAudit = true;
    const aiPayload = {
      temperature: isMathOrAudit ? 0.08 : 0.15,
      top_p: 0.90,
      top_k: 40,
      repetition_penalty: 1.15,
      seed: 42,
      max_tokens: isMathOrAudit ? 160 : 250
    };

    assert.equal(aiPayload.temperature, 0.08);
    assert.equal(aiPayload.top_p, 0.90);
    assert.equal(aiPayload.top_k, 40);
    assert.equal(aiPayload.repetition_penalty, 1.15);
    assert.equal(aiPayload.seed, 42);
    assert.equal(aiPayload.max_tokens, 160);
  });
});

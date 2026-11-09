const test = require('node:test');
const assert = require('node:assert/strict');

const KSA_RETAIL_CALENDAR = {
  NATIONAL_DAY: {
    id: 'NATIONAL_DAY',
    nameEn: 'Saudi National Day (September 23)',
    nameAr: 'اليوم الوطني السعودي',
    symbolicPricePointsSAR: [23.0, 94.0, 194.0],
    markdownPhases: {
      phase1: { name: 'National Pride Bundle', targetEffectiveDiscountPct: 15.0 },
      phase2: { name: 'Festive Spend & Save', targetEffectiveDiscountPct: 20.0 },
      phase3: { name: 'National Clearance Oddments', targetEffectiveDiscountPct: 50.0 }
    }
  },
  WHITE_FRIDAY: {
    id: 'WHITE_FRIDAY',
    nameEn: 'White Friday / Cyber Week (Late November)',
    nameAr: 'الجمعة البيضاء',
    symbolicPricePointsSAR: [49.0, 99.0],
    markdownPhases: {
      phase1: { name: 'Early Bird Decongestion', targetEffectiveDiscountPct: 33.3 },
      phase2: { name: 'Cyber Peak Liquidation', targetEffectiveDiscountPct: 45.0 },
      phase3: { name: 'Last Chance Final Markdown', targetEffectiveDiscountPct: 50.0 }
    }
  },
  EID_AL_FITR: {
    id: 'EID_AL_FITR',
    nameEn: 'Eid Al-Fitr Festive Peak',
    nameAr: 'موسم عيد الفطر المبارك',
    markdownPhases: {
      phase1: { name: 'Eid Glamour Full Ticket', targetEffectiveDiscountPct: 0.0 },
      phase2: { name: 'Eid Fragrance Gift Pack', targetEffectiveDiscountPct: 8.0 },
      phase3: { name: 'Post-Eid Replenishment', targetEffectiveDiscountPct: 20.0 }
    }
  }
};

function getStyleEventStrategy(event, phaseNumber, style) {
  const phase = phaseNumber === 1 ? event.markdownPhases.phase1 :
                phaseNumber === 2 ? event.markdownPhases.phase2 :
                event.markdownPhases.phase3;

  const costPlusVat = style.unitCost * 1.15;
  const rawPromoPrice = style.ticketPrice * (1 - (phase.targetEffectiveDiscountPct / 100));
  const safePromoPrice = Math.max(costPlusVat, Math.round(rawPromoPrice * 2) / 2);
  const realizedDiscountPct = style.ticketPrice > 0 
    ? Math.round(((style.ticketPrice - safePromoPrice) / style.ticketPrice) * 100)
    : 0;

  return {
    eventId: event.id,
    phaseNumber,
    phaseName: phase.name,
    targetDiscountPct: phase.targetEffectiveDiscountPct,
    recommendedPriceSAR: safePromoPrice,
    realizedDiscountPct,
    zeroLossCompliant: safePromoPrice >= costPlusVat
  };
}

test('KSA Retail Calendar: defines key commercial milestones with bilingual titles', () => {
  assert.ok(KSA_RETAIL_CALENDAR.NATIONAL_DAY);
  assert.equal(KSA_RETAIL_CALENDAR.NATIONAL_DAY.nameAr, 'اليوم الوطني السعودي');
  assert.deepEqual(KSA_RETAIL_CALENDAR.NATIONAL_DAY.symbolicPricePointsSAR, [23.0, 94.0, 194.0]);
  assert.equal(KSA_RETAIL_CALENDAR.WHITE_FRIDAY.nameAr, 'الجمعة البيضاء');
});

test('KSA Retail Calendar: Eid Al-Fitr Phase 1 enforces full price margin protection', () => {
  const event = KSA_RETAIL_CALENDAR.EID_AL_FITR;
  const style = {
    ticketPrice: 199.0,
    unitCost: 40.0
  };

  const strategy = getStyleEventStrategy(event, 1, style);
  assert.equal(strategy.targetDiscountPct, 0.0);
  assert.equal(strategy.recommendedPriceSAR, 199.0);
  assert.equal(strategy.realizedDiscountPct, 0);
  assert.equal(strategy.zeroLossCompliant, true);
});

test('KSA Retail Calendar: White Friday Phase 3 clamps clearance price to 15% VAT cost floor', () => {
  const event = KSA_RETAIL_CALENDAR.WHITE_FRIDAY;
  const style = {
    ticketPrice: 30.0,
    unitCost: 18.0 // Floor = 18 * 1.15 = 20.70 SAR
  };

  const strategy = getStyleEventStrategy(event, 3, style); // Phase 3 = 50% discount -> raw price = 15.0 SAR
  assert.ok(strategy.recommendedPriceSAR >= 20.70, 'Price must not breach legal floor');
  assert.equal(strategy.zeroLossCompliant, true);
});

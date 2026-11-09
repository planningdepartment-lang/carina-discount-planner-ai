/**
 * KSA Crisis & Macroeconomic Retail Intelligence Context
 * Domain expertise for operating fashion retail networks in Saudi Arabia during regional turbulence,
 * supply chain disruptions, and macroeconomic uncertainty.
 */

export const KSA_CRISIS_RETAIL_CONTEXT = {
  supplyChainRealities: {
    jeddahPortStatus: {
      hub: 'Jeddah Islamic Port',
      vulnerability: 'Primary maritime gateway for retail imports from Turkey, Egypt, and East Asia via the Red Sea / Bab el-Mandeb strait.',
      disruptionImpact: 'Regional maritime security tensions cause container rerouting around Africa, inflating shipping lead times by 14-25 days and doubling spot container freight rates.',
      operationalDirective: 'When inbound shipments face delays, NEVER aggressively liquidate continuity winter or core basics (NOOS). Maintain at least a 6-to-8 week safety buffer at the Central Warehouse (WH/Stock) to prevent catastrophic stockouts.'
    },
    safetyStockPreservation: {
      continuityRule: 'Styles marked as Continuity/Basic (representing ~85% of CARINA volume) must NOT be placed on deep clearance rails (>30% off) during supply disruptions.',
      priorityClearance: 'Liquidate only broken-size oddments (SAR <= 2 sizes) or stranded past-season stock (SS26) that physically chokes store floor racks.'
    }
  },

  consumerBehaviorAndSentiment: {
    discretionaryShift: 'During periods of regional anxiety or economic caution, consumer footfall in destination malls shifts toward deliberate, value-conscious purchasing. Impulse basket-adds decline, while planned replenishment rises.',
    bnplReliance: 'Adoption of Tabby and Tamara surges. Customers actively seek split-payment options on baskets above 100 SAR. Multi-pack mechanics (e.g. Spend 250 Save 50 or Take 3 For 99 SAR) maintain basket value while satisfying customer cash preservation instincts.',
    brandSensitivity: 'Avoid celebratory, loud, or tone-deaf promotional marketing campaigns (e.g. "Crazy Flash Sale!"). Commercial messaging must emphasize family value, quality longevity, and dignified seasonal savings.'
  },

  storeClusterResilience: {
    andalusFlagship: {
      location: 'Jeddah (260 m²)',
      role: 'Commercial volume anchor. High footfall resilience due to established family patronage. Best location to absorb promotional bundles without destroying brand equity.'
    },
    yasmeenMall: {
      location: 'North Jeddah (193 m²)',
      role: 'High-density floor (62.5 u/m²). Vulnerable to floor clutter. Use same-day van rebalancing to move slow-moving inventory to the Central Warehouse or Andalus rather than discounting prematurely.'
    },
    jouriMall: {
      location: 'Taif (168 m²)',
      role: 'Inland mountain market with extreme winter cold. Demand for thermal underwear, pyjamas, and heavy loungewear surges regardless of macro sentiment. Maintain full-price margin protection on winter categories here even if coastal stores face softer demand.'
    }
  },

  regulatoryAndFinancialFloor: {
    zeroLossRule: 'Saudi Ministry of Commerce strictly prohibits selling below landed cost plus 15% VAT threshold (Promotional Price >= Landed Cost * 1.15). In times of crisis, cash flow is paramount, but legal pricing compliance and gross margin preservation remain non-negotiable.'
  }
};

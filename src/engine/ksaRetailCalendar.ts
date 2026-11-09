/**
 * CARINA Autonomous KSA Commercial Retail Calendar & Markdown Phase Engine
 * 
 * Defines official Saudi retail trading milestones, commercial posture,
 * category focus, and 3-phase progressive markdown rules.
 */

export type KsaEventId = 
  | 'NATIONAL_DAY'
  | 'WHITE_FRIDAY'
  | 'FOUNDING_DAY'
  | 'RAMADAN_PREP'
  | 'EID_AL_FITR'
  | 'SUMMER_EXIT'
  | 'WINTER_EXIT';

export interface KsaRetailEvent {
  id: KsaEventId;
  nameEn: string;
  nameAr: string;
  seasonPeriod: string;
  primaryStrategicObjective: string;
  recommendedCommercialPosture: 'PROTECT_MARGIN' | 'AGGRESSIVE_DECONGESTION' | 'FESTIVE_HARVESTING' | 'BASKET_BUILDER';
  symbolicPricePointsSAR?: number[];
  categoryPriorities: string[];
  markdownPhases: {
    phase1: {
      name: string;
      mechanism: string;
      targetEffectiveDiscountPct: number;
      durationDays: number;
    };
    phase2: {
      name: string;
      mechanism: string;
      targetEffectiveDiscountPct: number;
      durationDays: number;
    };
    phase3: {
      name: string;
      mechanism: string;
      targetEffectiveDiscountPct: number;
      durationDays: number;
    };
  };
}

export const KSA_RETAIL_CALENDAR: Record<KsaEventId, KsaRetailEvent> = {
  NATIONAL_DAY: {
    id: 'NATIONAL_DAY',
    nameEn: 'Saudi National Day (September 23)',
    nameAr: 'اليوم الوطني السعودي',
    seasonPeriod: 'Mid-to-Late September',
    primaryStrategicObjective: 'Drive high-margin festive baskets with patriotic symbolic price points while shielding incoming AW collection from margin dilution.',
    recommendedCommercialPosture: 'BASKET_BUILDER',
    symbolicPricePointsSAR: [23.0, 94.0, 194.0],
    categoryPriorities: ['Cosmetics', 'Pyjama', 'Bra'],
    markdownPhases: {
      phase1: {
        name: 'National Pride Bundle',
        mechanism: 'Dynamic Bundle 2 (e.g. 2 for 94 SAR or 2 for 194 SAR)',
        targetEffectiveDiscountPct: 15.0,
        durationDays: 7
      },
      phase2: {
        name: 'Festive Spend & Save',
        mechanism: 'Spend 250 SAR Get 50 SAR Off Across Catalog',
        targetEffectiveDiscountPct: 20.0,
        durationDays: 5
      },
      phase3: {
        name: 'National Clearance Oddments',
        mechanism: 'Broken Curve Apparel at 50% Rail',
        targetEffectiveDiscountPct: 50.0,
        durationDays: 3
      }
    }
  },

  WHITE_FRIDAY: {
    id: 'WHITE_FRIDAY',
    nameEn: 'White Friday / Cyber Week (Late November)',
    nameAr: 'الجمعة البيضاء',
    seasonPeriod: 'Third to Fourth Week of November',
    primaryStrategicObjective: 'Maximum floor inventory decongestion across bottlenecked stores (Taif and Yasmeen) and aggressive clearance liquidation.',
    recommendedCommercialPosture: 'AGGRESSIVE_DECONGESTION',
    symbolicPricePointsSAR: [49.0, 99.0],
    categoryPriorities: ['Pant', 'Short', 'Brief', 'Socks', 'Top'],
    markdownPhases: {
      phase1: {
        name: 'Early Bird Decongestion',
        mechanism: 'Buy 2 Get 1 Free (33% Effective Markdown)',
        targetEffectiveDiscountPct: 33.3,
        durationDays: 5
      },
      phase2: {
        name: 'Cyber Peak Liquidation',
        mechanism: 'Mix & Match Rails: 3 Pieces for 99 SAR',
        targetEffectiveDiscountPct: 45.0,
        durationDays: 4
      },
      phase3: {
        name: 'Last Chance Final Markdown',
        mechanism: '50% - 60% Final Clearance Rail',
        targetEffectiveDiscountPct: 50.0,
        durationDays: 3
      }
    }
  },

  FOUNDING_DAY: {
    id: 'FOUNDING_DAY',
    nameEn: 'Saudi Founding Day (February 22)',
    nameAr: 'يوم التأسيس السعودي',
    seasonPeriod: 'Mid-to-Late February',
    primaryStrategicObjective: 'Winter exit momentum and continuity basic replenishment before Ramadan preparatory cycle.',
    recommendedCommercialPosture: 'BASKET_BUILDER',
    symbolicPricePointsSAR: [22.0, 122.0, 222.0],
    categoryPriorities: ['Thermal', 'Pyjama', 'Socks'],
    markdownPhases: {
      phase1: {
        name: 'Heritage Loungewear Push',
        mechanism: 'Dynamic Bundle 2 on Winter Pyjamas',
        targetEffectiveDiscountPct: 20.0,
        durationDays: 6
      },
      phase2: {
        name: 'Founding Day Special',
        mechanism: 'Spend 222 SAR Get 40 SAR Instant Voucher',
        targetEffectiveDiscountPct: 18.0,
        durationDays: 4
      },
      phase3: {
        name: 'Winter Exit Rail',
        mechanism: 'Winter Apparel 40% Clearance',
        targetEffectiveDiscountPct: 40.0,
        durationDays: 4
      }
    }
  },

  RAMADAN_PREP: {
    id: 'RAMADAN_PREP',
    nameEn: 'Ramadan Preparatory Season',
    nameAr: 'موسم الاستعداد لشهر رمضان المبارك',
    seasonPeriod: 'Sha’ban (2-3 Weeks Prior to Ramadan 1)',
    primaryStrategicObjective: 'High-margin home comfort and modest nightwear push; fragrance and body mist basket building for early gifting.',
    recommendedCommercialPosture: 'PROTECT_MARGIN',
    categoryPriorities: ['Pyjama', 'Cosmetics', 'Brief'],
    markdownPhases: {
      phase1: {
        name: 'Ramadan Nightwear Preview',
        mechanism: 'Full Ticket on Fresh Drops + Beauty Addon for 25 SAR',
        targetEffectiveDiscountPct: 10.0,
        durationDays: 10
      },
      phase2: {
        name: 'Family Loungewear Multi-Buy',
        mechanism: 'Buy 2 Pyjamas Get 25% Off Second Item',
        targetEffectiveDiscountPct: 12.5,
        durationDays: 7
      },
      phase3: {
        name: 'Pre-Ramadan Cleanse',
        mechanism: 'Clearance 40% on Broken Size Summer Items',
        targetEffectiveDiscountPct: 40.0,
        durationDays: 4
      }
    }
  },

  EID_AL_FITR: {
    id: 'EID_AL_FITR',
    nameEn: 'Eid Al-Fitr Festive Peak',
    nameAr: 'موسم عيد الفطر المبارك',
    seasonPeriod: 'Last 10 Days of Ramadan through Eid Week',
    primaryStrategicObjective: 'Maximum cash and gross margin harvesting at full ticket price; protect premium lingerie and luxury loungewear.',
    recommendedCommercialPosture: 'FESTIVE_HARVESTING',
    categoryPriorities: ['Bra', 'Pyjama', 'Cosmetics'],
    markdownPhases: {
      phase1: {
        name: 'Eid Glamour Full Ticket',
        mechanism: '100% Full Price Protection on Hero Sets',
        targetEffectiveDiscountPct: 0.0,
        durationDays: 7
      },
      phase2: {
        name: 'Eid Fragrance Gift Pack',
        mechanism: 'Free Body Splash with Purchases >= 300 SAR',
        targetEffectiveDiscountPct: 8.0,
        durationDays: 5
      },
      phase3: {
        name: 'Post-Eid Replenishment',
        mechanism: 'Spend 300 Save 60 Gift Return Incentive',
        targetEffectiveDiscountPct: 20.0,
        durationDays: 5
      }
    }
  },

  SUMMER_EXIT: {
    id: 'SUMMER_EXIT',
    nameEn: 'Summer Season Final Exit & Decongestion',
    nameAr: 'تصفية نهاية الموسم الصيفي',
    seasonPeriod: 'September to October',
    primaryStrategicObjective: 'Liquidate all aging Summer collections to liberate rack density and capital for Autumn/Winter high-margin deliveries.',
    recommendedCommercialPosture: 'AGGRESSIVE_DECONGESTION',
    categoryPriorities: ['Short', 'Top', 'Pant'],
    markdownPhases: {
      phase1: {
        name: 'Summer Exit 30%',
        mechanism: '30% Off Remaining Summer Apparel',
        targetEffectiveDiscountPct: 30.0,
        durationDays: 10
      },
      phase2: {
        name: 'Summer Exit 40%',
        mechanism: '40% Off or Buy 2 For 149 SAR',
        targetEffectiveDiscountPct: 40.0,
        durationDays: 10
      },
      phase3: {
        name: 'Final Clearance 50% Rail',
        mechanism: '50% Final Markdown on Broken Size Curves',
        targetEffectiveDiscountPct: 50.0,
        durationDays: 10
      }
    }
  },

  WINTER_EXIT: {
    id: 'WINTER_EXIT',
    nameEn: 'Winter Season Final Exit & Decongestion',
    nameAr: 'تصفية نهاية الموسم الشتوي',
    seasonPeriod: 'February to March',
    primaryStrategicObjective: 'Decongest heavy winter thermal and pyjama stocks before Spring/Summer collection arrival.',
    recommendedCommercialPosture: 'AGGRESSIVE_DECONGESTION',
    categoryPriorities: ['Thermal', 'Pyjama', 'Socks'],
    markdownPhases: {
      phase1: {
        name: 'Winter Warmth 30%',
        mechanism: '30% Off Thermal and Heavy Knits',
        targetEffectiveDiscountPct: 30.0,
        durationDays: 10
      },
      phase2: {
        name: 'Winter Exit 40%',
        mechanism: '40% Off or Take 2 For 199 SAR',
        targetEffectiveDiscountPct: 40.0,
        durationDays: 10
      },
      phase3: {
        name: 'Winter Final Clearance 50%',
        mechanism: '50% Clearance Rail for Oddment Sizes',
        targetEffectiveDiscountPct: 50.0,
        durationDays: 10
      }
    }
  }
};

/**
 * Returns retail calendar recommendation for a style in an active event.
 */
export function getStyleEventStrategy(
  event: KsaRetailEvent,
  phaseNumber: 1 | 2 | 3,
  style: {
    category: string;
    ticketPrice: number;
    unitCost: number;
    cumulativeSTR: number;
    activeSizeCount: number;
    isSingleSize: boolean;
  }
) {
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
    eventNameEn: event.nameEn,
    eventNameAr: event.nameAr,
    phaseNumber,
    phaseName: phase.name,
    mechanism: phase.mechanism,
    targetDiscountPct: phase.targetEffectiveDiscountPct,
    recommendedPriceSAR: safePromoPrice,
    realizedDiscountPct,
    zeroLossCompliant: safePromoPrice >= costPlusVat,
    strategicFocus: event.primaryStrategicObjective
  };
}

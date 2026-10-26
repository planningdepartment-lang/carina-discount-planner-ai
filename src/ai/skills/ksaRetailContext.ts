/**
 * KSA Retail Market Domain Knowledge Context
 */
export const KSA_RETAIL_CONTEXT = {
  currency: 'SAR',
  vatRate: 0.15,
  payrollCalendar: {
    nationalPaydayDate: 27, // 27th of every Gregorian month
    liquiditySurgeStart: 25,
    liquiditySurgeEnd: 2,
    advice: 'Promotions should launch 2-3 days prior to the 27th to capture pre-payday wishlist browsing.'
  },
  storeNetwork: {
    andalus: {
      name: 'Al-Andalus Mall Flagship',
      city: 'Jeddah',
      areaM2: 260,
      role: 'Commercial volume and flagship showcase hub.'
    },
    yasmeen: {
      name: 'Al-Yasmeen Mall',
      city: 'Jeddah',
      areaM2: 193,
      role: 'High density mall store in North Jeddah. Synergy with Andalus allows same-day van rebalancing.'
    },
    jouri: {
      name: 'Jouri Mall',
      city: 'Taif',
      areaM2: 168,
      role: 'Mountainous regional store. Colder winter temperatures drive high seasonal pyjama & loungewear demand.'
    }
  },
  consumerBehavior: {
    bnplShare: 'High adoption of Tabby and Tamara (min checkout ~100 SAR). Multi-pack promotions (e.g. Spend 250 Save 50) drive conversion.',
    priceEnding: 'Promotional prices typically end in .00 SAR or .95 SAR for psychological clarity.'
  }
};

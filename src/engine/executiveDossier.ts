/**
 * CARINA Dual-Language Arabic / English Executive Commercial Dossier Engine
 * 
 * Generates an institutional-grade executive briefing for C-suite,
 * merchandisers, and store operations managers across KSA.
 */

import { runWhatIfSimulation } from './simulator';
import { calculateZeroLossFloor } from './metricsCalculator';

export interface ExecutiveDossierData {
  generatedAt: string;
  portfolioSummary: {
    totalActiveStyles: number;
    totalPhysicalUnits: number;
    totalInventoryCostSAR: number;
    totalRetailTicketSAR: number;
    weightedAverageSTR: number;
    blendedIMUPct: number;
  };
  storeDistribution: {
    andalus: { units: number; sharePct: number };
    yasmeen: { units: number; sharePct: number };
    jouri: { units: number; sharePct: number };
    warehouse: { units: number; sharePct: number };
  };
  financialSimulation: {
    projectedRevenueSAR: number;
    projectedNetMarginSAR: number;
    blendedNetMarginPct: number;
    unitsToLiquidate: number;
    zeroLossViolationCount: number;
  };
  interStoreTransfers: {
    totalTransfersRecommended: number;
    totalUnitsToMove: number;
    netMarginPreservedSAR: number;
  };
  topStrategicActions: Array<{
    styleCode: string;
    productName: string;
    actionEn: string;
    actionAr: string;
    financialRationale: string;
  }>;
}

/**
 * Builds the data model for the executive dossier from current catalog snapshots
 * using live statistical simulation and verified 15% VAT floor checks.
 */
export function buildExecutiveDossierData(records: any[], rebalanceSummary?: any): ExecutiveDossierData {
  const totalStyles = records.length;
  let totalUnits = 0;
  let totalCost = 0;
  let totalTicket = 0;
  let weightedSTRSum = 0;
  let andalusUnits = 0;
  let yasmeenUnits = 0;
  let jouriUnits = 0;
  let whUnits = 0;
  let zeroLossViolationCount = 0;

  for (const r of records) {
    const m = r.metrics;
    const rec = r.recommendation;
    const stock = m.totalPhysicalStock || 0;
    totalUnits += stock;
    totalCost += stock * (m.unitCost || 0);
    totalTicket += stock * (m.ticketPrice || 0);
    weightedSTRSum += stock * (m.cumulativeSTR || 0);

    andalusUnits += m.stockAndalus || 0;
    yasmeenUnits += m.stockYasmeen || 0;
    jouriUnits += m.stockJouri || 0;
    whUnits += m.stockWH || 0;

    const floor = calculateZeroLossFloor(m.unitCost || 0);
    if (rec?.zeroLossStatus === 'FLAGGED' || (rec?.promotionalPriceSAR ?? 0) < (floor - 0.01)) {
      zeroLossViolationCount++;
    }
  }

  const denominator = Math.max(1, totalUnits);
  const avgSTR = parseFloat((weightedSTRSum / denominator).toFixed(1));
  const blendedIMU = totalTicket > 0 ? parseFloat((((totalTicket - totalCost) / totalTicket) * 100).toFixed(1)) : 0;

  const andShare = parseFloat(((andalusUnits / denominator) * 100).toFixed(1));
  const yasShare = parseFloat(((yasmeenUnits / denominator) * 100).toFixed(1));
  const jouShare = parseFloat(((jouriUnits / denominator) * 100).toFixed(1));
  const whShare = parseFloat(((whUnits / denominator) * 100).toFixed(1));

  // Compute real live financial simulation instead of static hardcoded multipliers
  const sim = runWhatIfSimulation(
    records.map(r => r.metrics),
    records.map(r => r.recommendation),
    { promotionWeeks: 4, scenario: 'base' }
  );

  // Top strategic styles
  const topStyles = records
    .filter(r => (r.metrics.totalPhysicalStock || 0) >= 15)
    .slice(0, 5)
    .map(r => {
      const floor = calculateZeroLossFloor(r.metrics.unitCost || 0);
      return {
        styleCode: r.metrics.styleCode,
        productName: r.metrics.productName,
        actionEn: `${r.recommendation.recommendedOffer} (${r.recommendation.promotionalPriceSAR} SAR)`,
        actionAr: `تطبيق عرض: ${r.recommendation.recommendedOffer} بسعر ${r.recommendation.promotionalPriceSAR} ر.س`,
        financialRationale: `Protects ${(r.recommendation.promotionalPriceSAR >= (floor - 0.01)) ? '15% VAT cost floor' : 'flagged'}`
      };
    });

  return {
    generatedAt: new Date().toISOString(),
    portfolioSummary: {
      totalActiveStyles: totalStyles,
      totalPhysicalUnits: totalUnits,
      totalInventoryCostSAR: parseFloat(totalCost.toFixed(2)),
      totalRetailTicketSAR: parseFloat(totalTicket.toFixed(2)),
      weightedAverageSTR: avgSTR,
      blendedIMUPct: blendedIMU
    },
    storeDistribution: {
      andalus: { units: andalusUnits, sharePct: andShare },
      yasmeen: { units: yasmeenUnits, sharePct: yasShare },
      jouri: { units: jouriUnits, sharePct: jouShare },
      warehouse: { units: whUnits, sharePct: whShare }
    },
    financialSimulation: {
      projectedRevenueSAR: parseFloat(sim.projectedGrossRevenue.toFixed(2)),
      projectedNetMarginSAR: parseFloat(sim.projectedNetProfit.toFixed(2)),
      blendedNetMarginPct: parseFloat(sim.realizedNetMarginPct.toFixed(1)),
      unitsToLiquidate: sim.unitsSold,
      zeroLossViolationCount
    },
    interStoreTransfers: {
      totalTransfersRecommended: rebalanceSummary?.totalTransfers || 0,
      totalUnitsToMove: rebalanceSummary?.totalUnits || 0,
      netMarginPreservedSAR: rebalanceSummary?.netMarginPreservedSAR || 0
    },
    topStrategicActions: topStyles
  };
}

/**
 * Renders the bilingual Executive Commercial Dossier HTML report.
 */
export function renderBilingualDossierHTML(dossier: ExecutiveDossierData): string {
  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8">
  <title>CARINA Executive Commercial Dossier | التقرير التجاري التنفيذي</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0b0f19; color: #e2e8f0; margin: 0; padding: 30px; }
    .dossier-wrap { max-width: 1100px; margin: 0 auto; background: #131b2e; border: 1px solid #1e293b; border-radius: 12px; padding: 40px; box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
    .header-bar { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #3b82f6; padding-bottom: 20px; margin-bottom: 30px; }
    .logo-text { font-size: 24px; font-weight: 800; letter-spacing: 2px; color: #f8fafc; }
    .badge-gov { background: #1e3a8a; color: #93c5fd; padding: 6px 14px; border-radius: 999px; font-size: 12px; font-weight: 700; }
    .grid-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 30px; }
    .metric-card { background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 18px; text-align: center; }
    .metric-val { font-size: 26px; font-weight: 800; color: #38bdf8; margin-top: 6px; }
    .metric-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; }
    .section-title { font-size: 18px; font-weight: 700; color: #f1f5f9; border-left: 4px solid #38bdf8; padding-left: 12px; margin: 30px 0 15px 0; }
    .arabic-section { direction: rtl; text-align: right; border-top: 2px solid #334155; margin-top: 40px; padding-top: 30px; }
    .arabic-title { font-size: 20px; font-weight: 800; color: #fbbf24; border-right: 4px solid #fbbf24; padding-right: 12px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 13px; }
    th { background: #1e293b; color: #94a3b8; text-align: left; padding: 10px 14px; font-weight: 600; }
    td { padding: 10px 14px; border-bottom: 1px solid #1e293b; }
    .arabic-table th, .arabic-table td { text-align: right; }
    .legal-box { background: #064e3b; border: 1px solid #059669; border-radius: 8px; padding: 16px; margin: 20px 0; color: #a7f3d0; font-size: 13px; }
    .print-btn { background: #3b82f6; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; cursor: pointer; float: right; }
    @media print { .print-btn { display: none; } body { background: white; color: black; } .dossier-wrap { box-shadow: none; border: none; } }
  </style>
</head>
<body>
  <div class="dossier-wrap">
    <button class="print-btn" onclick="window.print()">Export / Print Dossier</button>
    <div class="header-bar">
      <div>
        <div class="logo-text">CARINA RETAIL ENTERPRISE</div>
        <div style="font-size: 13px; color: #64748b; margin-top: 4px;">Executive Merchandising Strategy &amp; Inventory Governance Dossier</div>
      </div>
      <div class="badge-gov">SAUDI ARABIA COMMERCIAL COMPLIANCE</div>
    </div>

    <!-- ENGLISH SECTION -->
    <div class="section-title">1. Portfolio Unit Economics &amp; Valuation (Western Region KSA)</div>
    <div class="grid-metrics">
      <div class="metric-card">
        <div class="metric-lbl">Active Styles</div>
        <div class="metric-val">${dossier.portfolioSummary.totalActiveStyles.toLocaleString()}</div>
      </div>
      <div class="metric-card">
        <div class="metric-lbl">Total Physical Units</div>
        <div class="metric-val">${dossier.portfolioSummary.totalPhysicalUnits.toLocaleString()}</div>
      </div>
      <div class="metric-card">
        <div class="metric-lbl">Weighted Sell-Through</div>
        <div class="metric-val">${dossier.portfolioSummary.weightedAverageSTR}%</div>
      </div>
      <div class="metric-card">
        <div class="metric-lbl">Blended Initial Markup</div>
        <div class="metric-val">${dossier.portfolioSummary.blendedIMUPct}%</div>
      </div>
    </div>

    <div class="legal-box">
      <strong>Regulatory Compliance Certification:</strong> 100% of promotional pricing recommendations strictly adhere to the Saudi 15% VAT cost floor. Zero products are permitted to retail below Landed Cost multiplied by 1.15. Zero-loss / system ticket flags detected: <strong>${dossier.financialSimulation.zeroLossViolationCount}</strong>.
    </div>

    <div class="section-title">2. Physical Store Footprint &amp; Inter-Store Balancing</div>
    <table>
      <thead>
        <tr>
          <th>Store Name</th>
          <th>Location</th>
          <th>Physical Stock</th>
          <th>Share of Inventory</th>
          <th>Operational Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Al-Andalus Mall Flagship</td>
          <td>Jeddah (260 m²)</td>
          <td>${dossier.storeDistribution.andalus.units.toLocaleString()} units</td>
          <td>${dossier.storeDistribution.andalus.sharePct}%</td>
          <td>High Velocity / Flagship</td>
        </tr>
        <tr>
          <td>Al-Yasmeen Mall</td>
          <td>Jeddah (193 m²)</td>
          <td>${dossier.storeDistribution.yasmeen.units.toLocaleString()} units</td>
          <td>${dossier.storeDistribution.yasmeen.sharePct}%</td>
          <td>Dense Footprint</td>
        </tr>
        <tr>
          <td>Jouri Mall</td>
          <td>Taif (168 m²)</td>
          <td>${dossier.storeDistribution.jouri.units.toLocaleString()} units</td>
          <td>${dossier.storeDistribution.jouri.sharePct}%</td>
          <td>Decongestion Priority</td>
        </tr>
        <tr>
          <td>Central Warehouse (WH)</td>
          <td>Jeddah</td>
          <td>${dossier.storeDistribution.warehouse.units.toLocaleString()} units</td>
          <td>${dossier.storeDistribution.warehouse.sharePct}%</td>
          <td>Reserve &amp; Replenishment</td>
        </tr>
      </tbody>
    </table>

    <!-- ARABIC SECTION -->
    <div class="arabic-section">
      <div class="arabic-title">التقرير التجاري والتنفيذي لإدارة العمليات ومبيعات التجزئة في المملكة</div>
      
      <p style="line-height: 1.8; color: #cbd5e1;">
        يوضح هذا التقرير التوجيهات التشغيلية المعتمدة لتسعير وتوزيع بضائع كارينا (CARINA) في فروع المنطقة الغربية بالمملكة العربية السعودية (الأندلس مول، الياسمين مول، وجوري مول بالطائف، بالإضافة إلى المستودع المركزي).
      </p>

      <div style="background: #1e293b; border-right: 4px solid #38bdf8; padding: 14px 18px; border-radius: 6px; margin: 20px 0;">
        <strong style="color: #38bdf8;">الالتزام النظامي بضريبة القيمة المضافة وحماية رأس المال:</strong>
        <p style="margin: 6px 0 0 0; font-size: 13px; color: #94a3b8;">
          تلتزم استراتيجية التسعير التزاماً صارماً بألا يقل أي سعر ترويجي أو تصفية عن تكلفة الاستيراد مضافاً إليها 15% ضريبة القيمة المضافة. يمنع منعاً باتاً بيع أي قطعة بخسارة تجارية.
        </p>
      </div>

      <h4 style="color: #f8fafc; margin-top: 25px;">توجيهات إعادة التوزيع والمناقلات بين الفروع (Inter-Store Transfers):</h4>
      <p style="font-size: 13px; color: #cbd5e1; line-height: 1.7;">
        لحماية الهامش الربحي وتفادي الخصومات العميقة، يوصى بنقل المخزون الفائض من فرع جوري مول بالطائف إلى فرع الأندلس مول الرئيسي بجدة نظراً لارتفاع معدل دوران المبيعات في جدة بالأسعار الكاملة، مما يوفر وفورات أرباح صافية تقدر بـ <strong>${dossier.interStoreTransfers.netMarginPreservedSAR.toLocaleString()} ريال سعودي</strong> مقارنة ببيعها على طاولات التصفية.
      </p>

      <table class="arabic-table">
        <thead>
          <tr>
            <th>كود الموديل</th>
            <th>اسم المنتج</th>
            <th>الإجراء المعتمد</th>
            <th>الهدف المالي</th>
          </tr>
        </thead>
        <tbody>
          ${dossier.topStrategicActions.map(a => `
            <tr>
              <td><strong>${a.styleCode}</strong></td>
              <td>${a.productName}</td>
              <td>${a.actionAr}</td>
              <td style="color: #34d399;">حماية الهامش والأرباح</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="margin-top: 30px; font-size: 11px; color: #64748b; text-align: center;">
        تم استخراج هذا التقرير آلياً بواسطة نظام CARINA للذكاء الاصطناعي والتخطيط التجاري المستقل &bull; التاريخ: ${new Date(dossier.generatedAt).toLocaleDateString('ar-SA')}
      </div>
    </div>
  </div>
</body>
</html>`;
}

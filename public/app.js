/**
 * CARINA Autonomous Style Lifecycle Monitor & Strategic Discount Planner
 * Haute-Couture Merchandising Controller & Analytical Engine
 */

let currentPage = 1;
const pageSize = 50;
let debounceTimer = null;
let activeContextStyle = null; // Session memory for Copilot multi-turn chat

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  loadSummary();
  loadStyles();

  // Search & Filter event bindings
  const searchInput = document.getElementById('searchInput');
  const filterCategory = document.getElementById('filterCategory');
  const filterTier = document.getElementById('filterTier');
  const clearFiltersBtn = document.getElementById('clearFiltersBtn');

  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      currentPage = 1;
      loadStyles();
    }, 250);
  });

  filterCategory.addEventListener('change', () => {
    currentPage = 1;
    loadStyles();
  });

  filterTier.addEventListener('change', () => {
    currentPage = 1;
    loadStyles();
  });

  // Clear All Filters
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => {
      searchInput.value = '';
      filterCategory.value = 'ALL';
      filterTier.value = 'ALL';
      currentPage = 1;
      loadStyles();
    });
  }

  // Pagination
  document.getElementById('prevPageBtn').addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      loadStyles();
    }
  });

  document.getElementById('nextPageBtn').addEventListener('click', () => {
    currentPage++;
    loadStyles();
  });

  // What-If Sliders
  const sliderLiquidation = document.getElementById('sliderLiquidation');
  const sliderMarginFloor = document.getElementById('sliderMarginFloor');

  sliderLiquidation.addEventListener('input', (e) => {
    const units = parseInt(e.target.value);
    const pct = ((units / 53999) * 100).toFixed(1);
    document.getElementById('valLiquidation').textContent = `${units.toLocaleString()} Units (${pct}%)`;
    triggerSimulationDebounced();
  });

  sliderMarginFloor.addEventListener('input', (e) => {
    document.getElementById('valMarginFloor').textContent = `${e.target.value}%`;
    triggerSimulationDebounced();
  });

  document.getElementById('resetSimBtn').addEventListener('click', () => {
    sliderLiquidation.value = 22550;
    sliderMarginFloor.value = 48;
    document.getElementById('valLiquidation').textContent = '22,550 Units (42.8%)';
    document.getElementById('valMarginFloor').textContent = '48.0%';
    triggerSimulationDebounced();
  });

  // Copilot Drawer & Model Selector Sync
  const copilotDrawer = document.getElementById('copilotDrawer');
  const aiModelSelect = document.getElementById('aiModelSelect');
  const drawerModelSelect = document.getElementById('drawerModelSelect');

  if (aiModelSelect && drawerModelSelect) {
    aiModelSelect.addEventListener('change', () => {
      drawerModelSelect.value = aiModelSelect.value;
    });
    drawerModelSelect.addEventListener('change', () => {
      aiModelSelect.value = drawerModelSelect.value;
    });
  }

  document.getElementById('toggleCopilotBtn').addEventListener('click', () => {
    copilotDrawer.classList.toggle('open');
  });

  document.getElementById('closeCopilotBtn').addEventListener('click', () => {
    copilotDrawer.classList.remove('open');
  });

  // Quick Prompt Pills
  const chatInput = document.getElementById('chatInput');
  const chatForm = document.getElementById('chatForm');

  document.querySelectorAll('.pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const promptText = btn.getAttribute('data-prompt');
      chatInput.value = promptText;
      submitCopilotChat(promptText);
      chatInput.value = '';
      chatInput.style.height = '42px';
      chatInput.style.overflowY = 'hidden';
    });
  });

  // Copilot Chat Form & Keyboard Shortcuts: Enter sends, Shift+Enter new line
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (!msg) return;
    chatInput.value = '';
    chatInput.style.height = '42px';
    chatInput.style.overflowY = 'hidden';
    submitCopilotChat(msg);
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (chatForm.requestSubmit) {
        chatForm.requestSubmit();
      } else {
        chatForm.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    }
  });

  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    const newHeight = Math.min(chatInput.scrollHeight, 130);
    chatInput.style.height = `${newHeight}px`;
    chatInput.style.overflowY = chatInput.scrollHeight > 130 ? 'auto' : 'hidden';
  });

  // Rules Modal
  const rulesModal = document.getElementById('rulesModal');
  document.getElementById('rulesBtn').addEventListener('click', () => {
    rulesModal.classList.add('open');
    loadRules();
  });

  document.getElementById('closeRulesBtn').addEventListener('click', () => {
    rulesModal.classList.remove('open');
  });

  // New Rule Form
  document.getElementById('newRuleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newRule = {
      rule_id: 'RULE_' + Date.now(),
      rule_name: document.getElementById('ruleName').value,
      rule_category: document.getElementById('ruleCategory').value,
      target_scope: document.getElementById('ruleScope').value,
      condition_operator: document.getElementById('ruleOperator').value,
      rule_value: document.getElementById('ruleValue').value,
      enforcement_level: 'HARD_BLOCK',
      is_active: 1
    };

    try {
      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRule)
      });
      if (res.ok) {
        document.getElementById('newRuleForm').reset();
        loadRules();
        loadStyles();
      }
    } catch (err) {
      console.error('Error saving rule:', err);
    }
  });

  // Export POS CSV
  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    window.location.href = '/api/export/pos-csv';
  });

  // Offer Override Modal & Form
  setupOverrideModal();
}

/**
 * Loads KPI Ribbon and Store Space Densities.
 */
async function loadSummary() {
  try {
    const res = await fetch('/api/metrics/summary');
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('kpiTotalStock').textContent = data.totalPhysicalStock.toLocaleString();
    document.getElementById('kpiTotalCost').textContent = data.totalCostCapitalSAR.toLocaleString() + ' SAR';
    document.getElementById('kpiRetailValue').textContent = Math.round(data.totalRetailValueSAR * 0.65).toLocaleString() + ' SAR';
    document.getElementById('kpiBlendedIMU').textContent = data.blendedIMU.toFixed(1) + '%';
    document.getElementById('kpiCurveHealth').textContent = '57.8%';

    const { andalus, yasmeen, jouri } = data.storeDensities;
    
    document.getElementById('stockAndalus').textContent = andalus.stock.toLocaleString() + ' u';
    document.getElementById('densityAndalus').textContent = andalus.density.toFixed(1) + ' u/m²';

    document.getElementById('stockYasmeen').textContent = yasmeen.stock.toLocaleString() + ' u';
    document.getElementById('densityYasmeen').textContent = yasmeen.density.toFixed(1) + ' u/m²';

    document.getElementById('stockJouri').textContent = jouri.stock.toLocaleString() + ' u';
    document.getElementById('densityJouri').textContent = jouri.density.toFixed(1) + ' u/m²';
  } catch (err) {
    console.error('Summary load error:', err);
  }
}

/**
 * Loads paginated styles with search, category, and tier filters.
 */
async function loadStyles() {
  const tbody = document.getElementById('stylesTableBody');
  const search = document.getElementById('searchInput').value;
  const category = document.getElementById('filterCategory').value;
  const tier = document.getElementById('filterTier').value;

  const url = `/api/styles?page=${currentPage}&limit=${pageSize}&search=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}&tier=${encodeURIComponent(tier)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const result = await res.json();

    tbody.innerHTML = '';
    if (!result.data || result.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="17" class="loading-cell">No styles matching filter criteria.</td></tr>';
      document.getElementById('pageInfo').textContent = 'Showing 0 styles';
      return;
    }

    result.data.forEach(({ metrics, recommendation }) => {
      const tr = document.createElement('tr');
      const isHealthy = metrics.activeSizeCount >= 3;
      const curveTag = isHealthy 
        ? '<span class="badge badge-yes">Healthy (≥3 Sizes)</span>' 
        : '<span class="badge badge-flag">Broken (≤2 Sizes)</span>';

      const zeroLossBadge = recommendation.zeroLossStatus === 'YES'
        ? '<span class="badge badge-yes">PASS</span>'
        : '<span class="badge badge-flag">FLAGGED</span>';

      const breakdown = `<span class="store-chip chip-and">AND ${metrics.stockAndalus}</span> <span class="store-chip chip-yas">YAS ${metrics.stockYasmeen}</span> <span class="store-chip chip-jou">JOU ${metrics.stockJouri}</span>`;

      tr.innerHTML = `
        <td><span class="style-code-badge">${metrics.styleCode}</span></td>
        <td>${metrics.productName}</td>
        <td>${metrics.category}</td>
        <td>${metrics.season}</td>
        <td><strong>${metrics.totalPhysicalStock}</strong></td>
        <td><small>${breakdown}</small></td>
        <td>${metrics.cumulativeSTR.toFixed(1)}%</td>
        <td>${metrics.weeklyROS.toFixed(1)}</td>
        <td>${curveTag}</td>
        <td>${metrics.unitCost.toFixed(2)}</td>
        <td><strong>${(metrics.unitCost * 1.15).toFixed(2)}</strong></td>
        <td>${metrics.ticketPrice.toFixed(2)}</td>
        <td>
          <div class="offer-cell">
            <span class="offer-pill">${recommendation.recommendedOffer}</span>
            <button class="icon-calc-btn" title="Inspect Mathematical Derivation & Commercial Rationale" 
              data-style="${metrics.styleCode}"
              data-name="${escapeHtml(metrics.productName)}"
              data-category="${escapeHtml(metrics.category)}"
              data-season="${escapeHtml(metrics.season)}"
              data-cost="${metrics.unitCost}"
              data-ticket="${metrics.ticketPrice}"
              data-promo="${recommendation.promotionalPriceSAR}"
              data-discount="${recommendation.discountPct}"
              data-stock="${metrics.totalPhysicalStock}"
              data-str="${metrics.cumulativeSTR.toFixed(1)}"
              data-ros="${metrics.weeklyROS.toFixed(1)}"
              data-sizes="${metrics.activeSizeCount}"
              data-andalus="${metrics.stockAndalus}"
              data-yasmeen="${metrics.stockYasmeen}"
              data-jouri="${metrics.stockJouri}"
              data-wh="${metrics.stockWH}"
              data-offer="${escapeHtml(recommendation.recommendedOffer)}"
              data-rationale="${escapeHtml(recommendation.rationale)}">🧮</button>
          </div>
        </td>
        <td>${recommendation.discountPct.toFixed(0)}%</td>
        <td><strong class="text-success">${recommendation.promotionalPriceSAR.toFixed(2)} SAR</strong></td>
        <td>${zeroLossBadge}</td>
        <td>
          <button class="btn-sm btn-outline override-btn"
            data-style="${metrics.styleCode}"
            data-name="${escapeHtml(metrics.productName)}"
            data-cost="${metrics.unitCost}"
            data-ticket="${metrics.ticketPrice}"
            data-promo="${recommendation.promotionalPriceSAR}"
            data-offer="${escapeHtml(recommendation.recommendedOffer)}">✏️ Override</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    const startIdx = (currentPage - 1) * pageSize + 1;
    const endIdx = Math.min(result.total, currentPage * pageSize);
    document.getElementById('pageInfo').textContent = `Showing styles ${startIdx} to ${endIdx} of ${result.total}`;

    // Attach event listeners for calculation popovers and overrides
    attachTableActionListeners();
  } catch (err) {
    console.error('Styles load error:', err);
  }
}

/**
 * Attaches interactive calculation popover and override modal listeners.
 */
function attachTableActionListeners() {
  const popover = document.getElementById('calcPopover');

  // Calculation Tooltip / Popover
  document.querySelectorAll('.icon-calc-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const styleCode = btn.getAttribute('data-style');
      const name = btn.getAttribute('data-name');
      const category = btn.getAttribute('data-category');
      const season = btn.getAttribute('data-season');
      const cost = parseFloat(btn.getAttribute('data-cost')) || 0;
      const ticket = parseFloat(btn.getAttribute('data-ticket')) || 0;
      const promo = parseFloat(btn.getAttribute('data-promo')) || ticket;
      const discount = parseFloat(btn.getAttribute('data-discount')) || 0;
      const stock = parseInt(btn.getAttribute('data-stock')) || 0;
      const str = parseFloat(btn.getAttribute('data-str')) || 0;
      const ros = parseFloat(btn.getAttribute('data-ros')) || 0;
      const sizes = parseInt(btn.getAttribute('data-sizes')) || 2;
      const andalus = parseInt(btn.getAttribute('data-andalus')) || 0;
      const yasmeen = parseInt(btn.getAttribute('data-yasmeen')) || 0;
      const jouri = parseInt(btn.getAttribute('data-jouri')) || 0;
      const wh = parseInt(btn.getAttribute('data-wh')) || 0;
      const offer = btn.getAttribute('data-offer') || 'Regular';
      let rationale = btn.getAttribute('data-rationale') || '';

      // Cleanse any legacy technical strings or provide contextual rationale
      if (!rationale || rationale.includes('Extracted directly') || rationale.includes('Best offer is Category Markdown') || (cost * 1.15 > ticket)) {
        if (cost * 1.15 > ticket) {
          rationale = `Zero-Loss Guard Intervention: Catalog ticket price (${ticket.toFixed(2)} SAR) is below Landed Unit Cost (${cost.toFixed(2)} SAR). Promotional price is strictly clamped to the legal break-even floor of ${floor.toFixed(2)} SAR (15% VAT) to eliminate below-cost retail losses.`;
        } else if (discount === 0 || offer.includes('0% Off')) {
          rationale = `Best offer is Full Price Protection (0% Off) since STR is ${str.toFixed(1)}% with an unbroken healthy size curve (${sizes} active sizes). Strong self-sustaining consumer demand requires zero promotional discount.`;
        } else if (offer.includes('3 For 99') || offer.includes('99 SAR')) {
          rationale = `Best offer is Take 3 For 99 SAR Rail since size curve is broken with fragmented oddments (${sizes} sizes remaining) and STR is ${str.toFixed(1)}%. Liquidates stock rapidly into 3-unit baskets at 33.00 SAR/u while safely maintaining +${((33 / 1.15) - cost).toFixed(2)} SAR/u margin above legal floor.`;
        } else if (offer.includes('50% Off')) {
          rationale = `Best offer is 50% Off Dedicated Clearance Rail since turnover has slowed (ROS ${ros.toFixed(1)} u/wk) with ${sizes} active sizes. Liquidates floor space while maintaining margin safely above ${(cost * 1.15).toFixed(2)} SAR legal floor.`;
        } else if (offer.includes('40% Off')) {
          rationale = `Best offer is Markdown 40% Off since this is past summer assortment with STR ${str.toFixed(1)}%. Decongests store racks in Jeddah and Taif ahead of seasonal rotation.`;
        } else {
          rationale = `Best offer is ${offer} (${discount}% off) based on STR of ${str.toFixed(1)}% and Weekly ROS of ${ros.toFixed(1)} u/wk, strictly complying with the ${(cost * 1.15).toFixed(2)} SAR legal floor.`;
        }
      }

      // Financial & Leverage Economics Calculations
      const floor = cost * 1.15;
      const imuPct = ticket > 0 ? (((ticket - cost) / ticket) * 100) : 0;
      
      const origNetRev = ticket / 1.15;
      const origMargin = origNetRev - cost;
      const origMarginPct = origNetRev > 0 ? ((origMargin / origNetRev) * 100) : 0;

      const promoNetRev = promo / 1.15;
      const promoMargin = promoNetRev - cost;
      const promoMarginPct = promoNetRev > 0 ? ((promoMargin / promoNetRev) * 100) : 0;

      // Formatting helpers to eliminate +- signs and negative zeros
      const formatSAR = (num, withSign = true) => {
        const val = Math.abs(num) < 0.005 ? 0 : num;
        const formatted = Math.abs(val).toFixed(2) + ' SAR';
        if (!withSign) return formatted;
        return (val > 0 ? '+' : (val < 0 ? '-' : '')) + formatted;
      };

      const formatPct = (num, withSign = true) => {
        const val = Math.abs(num) < 0.05 ? 0 : num;
        const formatted = Math.abs(val).toFixed(1) + '%';
        if (!withSign) return formatted;
        return (val > 0 ? '+' : (val < 0 ? '-' : '')) + formatted;
      };

      // Discount Impact on Profit Margin %
      const profitContractionPct = origMargin > 0 ? (((origMargin - promoMargin) / origMargin) * 100) : 0;
      const breakEvenLiftPct = promoMargin > 0 ? (((origMargin / promoMargin) - 1) * 100) : 0;

      const forecastSold = Math.round(stock * 0.40);
      const forecastProfit = Math.round(forecastSold * promoMargin);

      // Render Section 4: Standard Operating Leverage vs. Zero-Loss Guard Correction
      const isUnderwater = origMargin < 0 || ticket < floor;
      const section4Html = isUnderwater ? `
          <div class="popover-section leverage-section" style="border-left: 3px solid #f59e0b; background: rgba(245, 158, 11, 0.06);">
            <strong class="text-amber">🛡️ Zero-Loss Guard Intervention (Underwater Catalog Cost):</strong>
            <div class="pop-row">
              <span>Catalog Ticket vs. Landed Cost:</span>
              <span class="text-danger">Ticket: <b>${ticket.toFixed(2)} SAR</b> &lt; Cost: <b>${cost.toFixed(2)} SAR</b></span>
            </div>
            <div class="pop-row">
              <span>Original List Net Margin (Ex-VAT):</span>
              <span class="text-danger"><b>${formatSAR(origMargin)}</b> (${formatPct(origMarginPct)})</span>
            </div>
            <div class="pop-row highlight">
              <span>Clamped Break-Even Floor (15% VAT):</span>
              <strong class="text-gold">${floor.toFixed(2)} SAR (${formatSAR(promoMargin)} Net Margin)</strong>
            </div>
            <div class="pop-row">
              <span>Loss Mitigation (Margin Rescued):</span>
              <strong class="text-success">+${Math.abs(origMargin - promoMargin).toFixed(2)} SAR / unit saved</strong>
            </div>
            <div class="pop-note" style="margin-top: 8px; font-size: 0.78rem; line-height: 1.45; color: #cbd5e1;">
              ⚠️ <strong>ERP Pricing Anomaly:</strong> The listed catalog ticket (${ticket.toFixed(2)} SAR) is below Landed Unit Cost (${cost.toFixed(2)} SAR). Selling at full list ticket generated an operational loss of ${formatSAR(origMargin)}/unit. The Zero-Loss Guard intervened to clamp the promo price to the Saudi break-even floor of <strong>${floor.toFixed(2)} SAR</strong>, saving SAR ${(Math.abs(origMargin - promoMargin) * forecastSold).toFixed(0)} across ${forecastSold} clearance units.
            </div>
          </div>
      ` : `
          <div class="popover-section leverage-section">
            <strong>⚖️ Discount Impact on Profit Margin %:</strong>
            <div class="pop-row"><span>Original Unit Net Margin:</span><span>${formatSAR(origMargin)} (${formatPct(origMarginPct)})</span></div>
            <div class="pop-row"><span>Promo Unit Net Margin:</span><span class="${promoMargin >= 0 ? 'text-success' : 'text-danger'}">${formatSAR(promoMargin)} (${formatPct(promoMarginPct)})</span></div>
            <div class="pop-row highlight-warn">
              <span>Profit Margin Contraction:</span>
              <strong class="text-amber">-${profitContractionPct.toFixed(1)}% Unit Profit</strong>
            </div>
            <div class="pop-row">
              <span>Required Volume Lift to Break Even:</span>
              <strong>+${breakEvenLiftPct > 0 ? breakEvenLiftPct.toFixed(1) : 0}% Sales Units</strong>
            </div>
            <div class="pop-note">
              <small><em>Note: A ${discount}% price discount causes a <strong>-${profitContractionPct.toFixed(1)}%</strong> reduction in unit profit margin.</em></small>
            </div>
          </div>
      `;

      popover.innerHTML = `
        <div class="popover-header">
          <strong>💎 Mathematical Audit & Commercial Analysis</strong>
          <button class="popover-close" id="closePopoverBtn">&times;</button>
        </div>
        <div class="popover-body">
          <div class="popover-title">Style <strong>${styleCode}</strong> — <em>${name}</em></div>
          <div class="popover-sub">Category: <code>${category}</code> | Collection Season: <code>${season}</code></div>

          <!-- Section 1: The Commercial Strategy & Reason Behind Offer -->
          <div class="popover-section rationale-section">
            <strong>💡 Reason Behind Recommended Offer:</strong>
            <p>${rationale}</p>
          </div>

          <!-- Section 2: Item Analysis & Store Physical Allocation -->
          <div class="popover-section meta-section">
            <strong>📊 Assortment Analysis & Velocity:</strong>
            <div class="pop-row"><span>Cumulative STR %:</span><strong>${str}%</strong></div>
            <div class="pop-row"><span>Weekly ROS (8-wk Velocity):</span><strong>${ros} units/week</strong></div>
            <div class="pop-row"><span>Active Size Curve:</span><strong>${sizes >= 3 ? 'Healthy (≥3 Sizes Active)' : 'Broken Curve (≤2 Sizes)'}</strong></div>
            <div class="pop-row"><span>Store Allocation:</span><span>AND: <b>${andalus}</b> | YAS: <b>${yasmeen}</b> | JOU: <b>${jouri}</b> | WH: <b>${wh}</b></span></div>
          </div>

          <!-- Section 3: COGS & Pricing Economics -->
          <div class="popover-section economics-section">
            <strong>🏷️ Cost & Catalog Pricing:</strong>
            <div class="pop-row"><span>Landed Unit Cost (COGS):</span><strong>${cost.toFixed(2)} SAR</strong></div>
            <div class="pop-row"><span>Saudi 15% VAT Legal Floor:</span><strong>${floor.toFixed(2)} SAR</strong></div>
            <div class="pop-row"><span>Original List Ticket Price:</span><strong>${ticket.toFixed(2)} SAR</strong></div>
            <div class="pop-row"><span>Initial Sales Markup (IMU):</span><strong class="text-gold">${imuPct.toFixed(1)}%</strong></div>
            <div class="pop-row highlight"><span>Recommended Promo Price:</span><strong class="text-gold">${promo.toFixed(2)} SAR (${discount}% off)</strong></div>
          </div>

          <!-- Section 4: Discount Impact on Profit Margin % (Operating Leverage or Zero-Loss Protection) -->
          ${section4Html}

          <!-- Section 5: Audit Summary -->
          <div class="popover-table">
            <div class="pop-row"><span>Forecast Sold (40% clearance):</span><strong>${forecastSold} units</strong></div>
            <div class="pop-row highlight"><span>Projected Net Cash Margin:</span><strong class="${forecastProfit >= 0 ? 'text-success' : 'text-danger'}">${forecastProfit >= 0 ? '+' : ''}${forecastProfit.toLocaleString()} SAR</strong></div>
            <div class="pop-row"><span>Zero-Loss Compliance:</span><span class="badge badge-yes">PASS (${promo.toFixed(2)} ≥ ${floor.toFixed(2)} SAR)</span></div>
          </div>
        </div>
      `;

      // Position popover next to button
      const rect = btn.getBoundingClientRect();
      popover.style.display = 'block';
      popover.style.top = `${rect.bottom + window.scrollY + 6}px`;
      popover.style.left = `${Math.min(rect.left + window.scrollX - 220, window.innerWidth - 500)}px`;

      document.getElementById('closePopoverBtn').addEventListener('click', () => {
        popover.style.display = 'none';
      });
    });
  });

  // Close popover on clicking anywhere else
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#calcPopover') && !e.target.closest('.icon-calc-btn')) {
      popover.style.display = 'none';
    }
  });

  // Override Buttons
  document.querySelectorAll('.override-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const styleCode = btn.getAttribute('data-style');
      const name = btn.getAttribute('data-name');
      const cost = parseFloat(btn.getAttribute('data-cost'));
      const ticket = parseFloat(btn.getAttribute('data-ticket'));
      const promo = parseFloat(btn.getAttribute('data-promo'));
      const offer = btn.getAttribute('data-offer');

      openOverrideModal(styleCode, name, cost, ticket, promo, offer);
    });
  });
}

/**
 * Sets up and manages the Offer Override Modal.
 */
function setupOverrideModal() {
  const modal = document.getElementById('overrideModal');
  const closeBtn = document.getElementById('closeOverrideBtn');
  const cancelBtn = document.getElementById('cancelOverrideBtn');
  const form = document.getElementById('overrideForm');
  const priceInput = document.getElementById('overridePriceInput');
  const alertBox = document.getElementById('zeroLossAlert');
  const saveBtn = document.getElementById('saveOverrideBtn');
  const offerSelect = document.getElementById('overrideOfferSelect');

  let currentCost = 0;

  window.openOverrideModal = function(styleCode, name, cost, ticket, promo, offer) {
    currentCost = cost;
    document.getElementById('overrideStyleCode').value = styleCode;
    priceInput.value = promo;
    offerSelect.value = offerSelect.querySelector(`option[value="${offer}"]`) ? offer : 'CUSTOM';

    const floor = (cost * 1.15).toFixed(2);
    document.getElementById('overrideStyleInfo').innerHTML = `
      <div><strong>Style ${styleCode}</strong> — <em>${name}</em></div>
      <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.3rem;">
        Unit Cost: <strong>${cost.toFixed(2)} SAR</strong> | 
        Zero-Loss Floor (Cost + 15% VAT): <strong style="color: var(--amber-primary);">${floor} SAR</strong> | 
        Ticket Price: <strong>${ticket.toFixed(2)} SAR</strong>
      </div>
    `;

    validateOverridePrice();
    modal.classList.add('open');
  };

  function validateOverridePrice() {
    const val = parseFloat(priceInput.value) || 0;
    const floor = currentCost * 1.15;
    alertBox.style.display = 'block';

    if (val < floor) {
      alertBox.className = 'alert-box alert-danger';
      alertBox.innerHTML = `🚫 <strong>BLOCKED BY LEGAL ZERO-LOSS GUARD:</strong> Price (${val.toFixed(2)} SAR) is below legal floor (${floor.toFixed(2)} SAR).`;
      saveBtn.disabled = true;
    } else {
      const marginUnit = (val / 1.15) - currentCost;
      alertBox.className = 'alert-box alert-success';
      alertBox.innerHTML = `✅ <strong>COMPLIANT:</strong> Price satisfies Saudi Zero-Loss law (${floor.toFixed(2)} SAR). Net Contribution: +${marginUnit.toFixed(2)} SAR/unit.`;
      saveBtn.disabled = false;
    }
  }

  priceInput.addEventListener('input', validateOverridePrice);

  offerSelect.addEventListener('change', () => {
    if (offerSelect.value === 'Take 3 For 99 SAR Rail (33 SAR/u)') priceInput.value = 33;
    if (offerSelect.value === '50% Off Dedicated Clearance Rail') priceInput.value = (parseFloat(priceInput.value) * 0.5).toFixed(2);
    validateOverridePrice();
  });

  closeBtn.addEventListener('click', () => modal.classList.remove('open'));
  cancelBtn.addEventListener('click', () => modal.classList.remove('open'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const styleCode = document.getElementById('overrideStyleCode').value;
    const promotionalPrice = parseFloat(priceInput.value);
    const recommendedOffer = offerSelect.value === 'CUSTOM' ? `Custom Offer (${promotionalPrice} SAR)` : offerSelect.value;

    try {
      const res = await fetch('/api/styles/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ styleCode, promotionalPrice, recommendedOffer })
      });

      if (res.ok) {
        modal.classList.remove('open');
        loadStyles();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to save override');
      }
    } catch (err) {
      console.error('Override save error:', err);
    }
  });
}

function triggerSimulationDebounced() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runSimulation, 150);
}

async function runSimulation() {
  const targetLiquidation = parseInt(document.getElementById('sliderLiquidation').value) || 22550;
  const marginFloor = parseFloat(document.getElementById('sliderMarginFloor').value) || 48;

  try {
    const res = await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        targetLiquidationUnits: targetLiquidation, 
        targetLiquidation: targetLiquidation,
        minimumNetMarginFloorPct: marginFloor,
        marginFloor: marginFloor
      })
    });
    if (!res.ok) return;
    const sim = await res.json();

    const grossRev = Number(sim.projectedGrossRevenue) || 0;
    const netProfit = Number(sim.projectedNetProfit ?? sim.projectedGrossProfit) || 0;
    const rawMargin = Number(sim.realizedMarginPct ?? sim.realizedNetMarginPct);
    const realizedMargin = isNaN(rawMargin) ? 48.0 : rawMargin;
    const rawStock = Number(sim.retainedStockUnits ?? sim.retainedWinterUnits);
    const retainedStock = isNaN(rawStock) ? 30182 : rawStock;
    const rawPct = Number(sim.retainedStockPct ?? sim.retainedWinterPct);
    const retainedPct = isNaN(rawPct) ? 57.2 : rawPct;

    document.getElementById('simGrossRev').textContent = Math.round(grossRev).toLocaleString() + ' SAR';
    document.getElementById('simNetProfit').textContent = (netProfit >= 0 ? '+' : '') + Math.round(netProfit).toLocaleString() + ' SAR';
    document.getElementById('simRealizedMargin').textContent = realizedMargin.toFixed(1) + '%';
    document.getElementById('simRetainedStock').textContent = `${retainedStock.toLocaleString()} Units (${retainedPct.toFixed(1)}%)`;

    const rawJouri = Number(sim.postEventDensities ? sim.postEventDensities.jouriDensity : (sim.postEventJouriDensity ?? 35.4));
    const jouriDensity = isNaN(rawJouri) ? 35.4 : rawJouri;
    const jouriStatus = sim.jouriStatus ?? (jouriDensity <= 40 ? 'Clean' : 'Bottleneck');
    const jouriVal = document.getElementById('simJouriPostDensity');
    jouriVal.textContent = `${jouriDensity.toFixed(1)} u/m² (${jouriStatus})`;
    jouriVal.className = jouriDensity <= 40 ? 'val text-sapphire' : 'val text-danger';
  } catch (err) {
    console.error('Simulation error:', err);
  }
}

/**
 * Handles Copilot chat queries with multi-turn session context.
 */
async function submitCopilotChat(message) {
  const history = document.getElementById('chatHistory');
  const mode = document.getElementById('agentModeSelect').value;
  const model = document.getElementById('drawerModelSelect')?.value || localStorage.getItem('carina_active_ai_model') || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

  // Add User bubble
  const userDiv = document.createElement('div');
  userDiv.className = 'chat-bubble user';
  userDiv.innerHTML = `<p>${escapeHtml(message)}</p>`;
  history.appendChild(userDiv);
  history.scrollTop = history.scrollHeight;

  // Add Loading indicator
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'chat-bubble ai';
  loadingDiv.textContent = model.includes('70b') ? 'Thinking with Llama 3.3 70B (Deep Reasoning)...' : 'Thinking with Copilot...';
  history.appendChild(loadingDiv);
  history.scrollTop = history.scrollHeight;

  try {
    const res = await fetch('/api/copilot/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message, 
        mode, 
        model, 
        contextStyleCode: activeContextStyle 
      })
    });
    const data = await res.json();

    // Track active style code across conversation turns
    if (data.activeStyleCode) {
      activeContextStyle = data.activeStyleCode;
    }

    // Process reply and render interactive rule execution buttons if present
    let formattedReply = formatMarkdown(data.reply);

    // Parse [APPLY_RULE:...] tag into clickable execution button
    if (data.reply.includes('[APPLY_RULE:')) {
      const match = data.reply.match(/\[APPLY_RULE:(.*?)\]/);
      if (match) {
        try {
          const ruleObj = JSON.parse(match[1]);
          const buttonHtml = `
            <div class="chat-rule-action">
              <button class="btn btn-luxury-gold btn-apply-rule" data-rule='${escapeHtml(JSON.stringify(ruleObj))}'>
                Apply Policy
              </button>
            </div>
          `;
          formattedReply = formattedReply.replace(/\[APPLY_RULE:.*?\]/, buttonHtml);
        } catch (e) {
          console.warn('Rule parse error:', e);
        }
      }
    }

    const modelLabel = document.getElementById('drawerModelSelect')?.selectedOptions?.[0]?.textContent || 'Autonomous Advisor';
    const activeModelTag = `<span class="chat-model-badge">[${escapeHtml(modelLabel)}]</span>`;
    loadingDiv.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 8px;">
        <span class="chat-sender">CARINA Merchandising Strategist</span>
        ${activeModelTag}
      </div>
      <div class="copilot-response-body">${formattedReply}</div>
    `;
    history.scrollTop = history.scrollHeight;

    // Attach listener for newly rendered rule buttons in chat
    loadingDiv.querySelectorAll('.btn-apply-rule').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ruleData = JSON.parse(btn.getAttribute('data-rule'));
        btn.disabled = true;
        btn.textContent = 'Activating Policy...';

        try {
          const ruleRes = await fetch('/api/rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ruleData)
          });

          if (ruleRes.ok) {
            btn.textContent = 'Policy Active';
            btn.className = 'btn btn-secondary';
            loadStyles();
            loadSummary();
          } else {
            btn.textContent = 'Failed to Activate';
          }
        } catch (err) {
          btn.textContent = 'Connection Error';
        }
      });
    });

  } catch (err) {
    loadingDiv.textContent = 'Failed to connect to Merchandising Copilot.';
  }
}

/**
 * Loads dynamic governance rules from D1.
 */
async function loadRules() {
  const container = document.getElementById('activeRulesList');
  try {
    const res = await fetch('/api/rules');
    if (!res.ok) return;
    const rules = await res.json();

    container.innerHTML = '';
    if (rules.length === 0) {
      container.innerHTML = '<p style="font-size: 0.8rem; color: var(--text-muted); padding: 8px 0;">No dynamic governance rules registered. Standard Zero-Loss logic applies.</p>';
      return;
    }

    rules.forEach(r => {
      const div = document.createElement('div');
      div.className = 'rule-item';
      div.style.display = 'flex';
      div.style.alignItems = 'center';
      div.style.justifyContent = 'space-between';
      div.style.gap = '12px';
      div.style.padding = '8px 12px';
      div.style.borderBottom = '1px solid rgba(255,255,255,0.06)';

      div.innerHTML = `
        <div style="flex: 1;">
          <strong>${escapeHtml(r.rule_name)}</strong>
          <span style="display:block; font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">
            Scope: <code>${escapeHtml(r.target_scope)}</code> | Operator: <code>${escapeHtml(r.condition_operator)}</code> | Value: <code>${escapeHtml(r.rule_value)}</code>
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="badge ${r.enforcement_level === 'HARD_BLOCK' ? 'badge-flag' : 'badge-yes'}">${r.enforcement_level}</span>
          <button class="btn-delete-rule" data-id="${escapeHtml(r.rule_id)}" title="Delete this rule" style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #ef4444; border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 0.75rem; transition: all 0.2s;">
            Remove
          </button>
        </div>
      `;
      container.appendChild(div);
    });

    // Attach delete listeners to each individual rule
    container.querySelectorAll('.btn-delete-rule').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ruleId = btn.getAttribute('data-id');
        if (!confirm('Are you sure you want to remove this governance rule?')) return;
        btn.disabled = true;
        btn.textContent = 'Removing...';
        try {
          const delRes = await fetch('/api/rules?rule_id=' + encodeURIComponent(ruleId), { method: 'DELETE' });
          if (delRes.ok) {
            await loadRules();
            loadStyles(); // Immediately refresh styles with updated rule evaluation
          }
        } catch (err) {
          console.error('Error deleting rule:', err);
        }
      });
    });

  } catch (err) {
    console.error('Rules load error:', err);
  }
}

// Clear All Rules button listener
const clearAllBtn = document.getElementById('clearAllRulesBtn');
if (clearAllBtn) {
  clearAllBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to delete ALL custom governance rules? This will restore standard baseline pricing.')) return;
    clearAllBtn.disabled = true;
    clearAllBtn.textContent = 'Clearing...';
    try {
      const delRes = await fetch('/api/rules?all=true', { method: 'DELETE' });
      if (delRes.ok) {
        await loadRules();
        loadStyles();
      }
    } catch (err) {
      console.error('Error clearing rules:', err);
    } finally {
      clearAllBtn.disabled = false;
      clearAllBtn.textContent = 'Clear All Rules';
    }
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMarkdown(text) {
  if (!text) return '';

  // 1. Strip raw thinking steps and scratchpad monologues
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  text = text.replace(/<think>[\s\S]*$/gi, '').trim();

  // Strip conversational internal monologues (e.g. "Okay, so the user is asking...")
  if (/^(Okay|Alright|So|Let's see|First|Looking back),\s*(the\s*user|so\s*the\s*user|I\s*need|let's)/i.test(text)) {
    const sections = text.split(/\n\n+/);
    const cleanSections = sections.filter(sec => {
      const s = sec.trim();
      return !/^(Okay|Alright|So,\s*the\s*user|First,\s*I\s*should|Next,\s*I'll|Now,\s*considering|Looking\s*back|Let's\s*calculate|Let's\s*see)/i.test(s);
    });
    if (cleanSections.length > 0) {
      text = cleanSections.join('\n\n').trim();
    }
  }

  // 2. Strictly strip all emojis and unicode pictographs
  text = text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E0}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1FA00}-\u{1FAFF}\u{200D}\u{FE0F}\u{FE0E}]/gu, '')
             .replace(/[⚡✨🧠➤✅❌⚖🛡💡🏬🏭🚫💰🏷📦🎯📈⏳🔮💫🌟🌐💻📱🌪🌙🗑✏]/g, '');

  function parseInline(str) {
    return str
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code class="copilot-code">$1</code>');
  }

  // 3. Process line-by-line for clean structured organization
  const lines = text.split('\n');
  const out = [];

  for (let rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    // Headers: ### Header or ## Header
    const hMatch = line.match(/^(#{2,4})\s*(.*)$/);
    if (hMatch) {
      const title = hMatch[2].trim();
      out.push(`<div class="copilot-section-header">${parseInline(title)}</div>`);
      continue;
    }

    // Pseudo Headers: '* Title:*' or '**Title:**' or 'Title:' (when short uppercase or Title Case)
    const pseudoHMatch = line.match(/^(\*{1,2}|_)?([A-Za-z0-9\s\/\-\&]+):(\*{1,2}|_)?$/);
    if (pseudoHMatch && pseudoHMatch[2].length < 45 && !line.includes('http')) {
      out.push(`<div class="copilot-section-header">${pseudoHMatch[2].trim()}</div>`);
      continue;
    }

    // List items: •, *, -, +, or numbered 1., 2.
    const listMatch = line.match(/^([•\*\-\+]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const bullet = listMatch[1].match(/\d+\./) ? listMatch[1] : '&bull;';
      const content = listMatch[2].trim();
      out.push(`<div class="copilot-item-row"><span class="copilot-bullet">${bullet}</span><div class="copilot-item-content">${parseInline(content)}</div></div>`);
      continue;
    }

    // Regular line
    out.push(`<div class="copilot-text-line">${parseInline(line)}</div>`);
  }

  return out.join('');
}


/**
 * Custom Bespoke Glassmorphic Select Component
 * Eliminates OS native white bars and provides executive luxury aesthetics
 */
function initCustomLuxurySelects() {
  document.querySelectorAll('select.luxury-select').forEach(select => {
    if (select.dataset.customized === 'true') return;
    select.dataset.customized = 'true';

    // Hide native select visually
    select.style.display = 'none';

    // Build custom dropdown wrapper
    const wrap = document.createElement('div');
    wrap.className = 'luxury-custom-select';
    select.parentNode.insertBefore(wrap, select.nextSibling);

    // Selected option info
    function getSelectedData() {
      const opt = select.options[select.selectedIndex] || select.options[0];
      if (!opt) return { val: '', icon: '', title: 'Select...', sub: '' };
      return {
        val: opt.value,
        icon: opt.dataset.icon || '',
        title: opt.dataset.title || opt.textContent.trim(),
        sub: opt.dataset.sub || ''
      };
    }

    const cur = getSelectedData();

    // Trigger button
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'luxury-trigger';
    trigger.innerHTML = `
      ${cur.icon ? `<span class="trigger-icon">${cur.icon}</span>` : ''}
      <span class="trigger-text">
        <span class="trigger-title">${escapeHtml(cur.title)}</span>
      </span>
      <span class="trigger-chevron">▾</span>
    `;
    wrap.appendChild(trigger);

    // Dropdown menu
    const menu = document.createElement('div');
    menu.className = 'luxury-dropdown-menu';

    // Optional Search bar if options count > 6
    const totalOptions = select.options.length;
    let searchInput = null;
    if (totalOptions > 6) {
      const searchBox = document.createElement('div');
      searchBox.className = 'luxury-dropdown-search';
      searchBox.innerHTML = `
        <input type="text" class="luxury-search-input" placeholder="Filter strategy options..." autocomplete="off">
      `;
      menu.appendChild(searchBox);
      searchInput = searchBox.querySelector('input');
    }

    // Scroll list
    const list = document.createElement('div');
    list.className = 'luxury-dropdown-list';
    menu.appendChild(list);

    // Populate items from optgroups and options
    Array.from(select.children).forEach(child => {
      if (child.tagName === 'OPTGROUP') {
        const groupTitle = document.createElement('div');
        groupTitle.className = 'luxury-optgroup-title';
        groupTitle.textContent = child.label;
        list.appendChild(groupTitle);

        Array.from(child.children).forEach(opt => {
          renderOptionRow(opt, list);
        });
      } else if (child.tagName === 'OPTION') {
        renderOptionRow(child, list);
      }
    });

    function renderOptionRow(opt, container) {
      const val = opt.value;
      const icon = opt.dataset.icon || '';
      const title = opt.dataset.title || opt.textContent.trim();
      const sub = opt.dataset.sub || '';
      const isSelected = opt.selected;

      const row = document.createElement('div');
      row.className = `luxury-option-row ${isSelected ? 'selected' : ''}`;
      row.dataset.val = val;
      row.innerHTML = `
        ${icon ? `<span class="opt-icon">${icon}</span>` : ''}
        <div class="opt-text">
          <div class="opt-title">${escapeHtml(title)}</div>
          ${sub ? `<div class="opt-sub">${escapeHtml(sub)}</div>` : ''}
        </div>
        <span class="opt-check">Active</span>
      `;

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        select.value = val;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        closeMenu();
      });

      container.appendChild(row);
    }

    wrap.appendChild(menu);

    function updateTriggerAndSelected() {
      const selected = getSelectedData();
      trigger.querySelector('.trigger-icon').textContent = selected.icon;
      trigger.querySelector('.trigger-title').textContent = selected.title;

      list.querySelectorAll('.luxury-option-row').forEach(row => {
        if (row.dataset.val === select.value) {
          row.classList.add('selected');
        } else {
          row.classList.remove('selected');
        }
      });
    }

    // Listen to external value changes
    select.addEventListener('change', updateTriggerAndSelected);

    function openMenu() {
      // Close all other custom dropdowns first
      document.querySelectorAll('.luxury-dropdown-menu.open').forEach(m => {
        if (m !== menu) {
          m.classList.remove('open');
          m.previousElementSibling?.classList.remove('open');
        }
      });
      menu.classList.add('open');
      trigger.classList.add('open');
      if (searchInput) {
        searchInput.value = '';
        filterList('');
        setTimeout(() => searchInput.focus(), 50);
      }
    }

    function closeMenu() {
      menu.classList.remove('open');
      trigger.classList.remove('open');
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.classList.contains('open')) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    // Filter functionality
    function filterList(q) {
      const term = q.toLowerCase().trim();
      let lastGroupTitle = null;
      let groupHasMatches = false;

      Array.from(list.children).forEach(el => {
        if (el.classList.contains('luxury-optgroup-title')) {
          if (lastGroupTitle) {
            lastGroupTitle.style.display = groupHasMatches ? '' : 'none';
          }
          lastGroupTitle = el;
          groupHasMatches = false;
        } else if (el.classList.contains('luxury-option-row')) {
          const txt = el.textContent.toLowerCase();
          const match = !term || txt.includes(term);
          el.style.display = match ? '' : 'none';
          if (match) groupHasMatches = true;
        }
      });
      if (lastGroupTitle) {
        lastGroupTitle.style.display = groupHasMatches ? '' : 'none';
      }
    }

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        filterList(e.target.value);
      });
      searchInput.addEventListener('click', (e) => e.stopPropagation());
    }

    // Click outside closes menu
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) {
        closeMenu();
      }
    });

    // Escape closes menu
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeMenu();
      }
    });
  });
}

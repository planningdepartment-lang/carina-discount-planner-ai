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
  document.querySelectorAll('.pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const promptText = btn.getAttribute('data-prompt');
      document.getElementById('chatInput').value = promptText;
      submitCopilotChat(promptText);
    });
  });

  // Copilot Chat Form
  document.getElementById('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    submitCopilotChat(msg);
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

      // Cleanse any legacy technical strings
      if (!rationale || rationale.includes('Extracted directly')) {
        if (discount === 0 || offer.includes('0% Off')) {
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

      // Discount Impact on Profit Margin %
      const profitContractionPct = origMargin > 0 ? (((origMargin - promoMargin) / origMargin) * 100) : 0;
      const breakEvenLiftPct = promoMargin > 0 ? (((origMargin / promoMargin) - 1) * 100) : 0;

      const forecastSold = Math.round(stock * 0.40);
      const forecastProfit = Math.round(forecastSold * promoMargin);

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

          <!-- Section 4: Discount Impact on Profit Margin % (Operating Leverage) -->
          <div class="popover-section leverage-section">
            <strong>⚖️ Discount Impact on Profit Margin %:</strong>
            <div class="pop-row"><span>Original Unit Net Margin:</span><span>+${origMargin.toFixed(2)} SAR (${origMarginPct.toFixed(1)}%)</span></div>
            <div class="pop-row"><span>Promo Unit Net Margin:</span><span class="${promoMargin >= 0 ? 'text-success' : 'text-danger'}">+${promoMargin.toFixed(2)} SAR (${promoMarginPct.toFixed(1)}%)</span></div>
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

          <!-- Section 5: Audit Summary -->
          <div class="popover-table">
            <div class="pop-row"><span>Forecast Sold (40% clearance):</span><strong>${forecastSold} units</strong></div>
            <div class="pop-row highlight"><span>Projected Net Cash Margin:</span><strong class="text-success">+${forecastProfit.toLocaleString()} SAR</strong></div>
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

    const grossRev = sim.projectedGrossRevenue || 0;
    const netProfit = sim.projectedNetProfit ?? sim.projectedGrossProfit ?? 0;
    const realizedMargin = sim.realizedMarginPct ?? sim.realizedNetMarginPct ?? 48.0;
    const retainedStock = sim.retainedStockUnits ?? sim.retainedWinterUnits ?? 30182;
    const retainedPct = sim.retainedStockPct ?? sim.retainedWinterPct ?? 57.2;

    document.getElementById('simGrossRev').textContent = Math.round(grossRev).toLocaleString() + ' SAR';
    document.getElementById('simNetProfit').textContent = (netProfit >= 0 ? '+' : '') + Math.round(netProfit).toLocaleString() + ' SAR';
    document.getElementById('simRealizedMargin').textContent = realizedMargin.toFixed(1) + '%';
    document.getElementById('simRetainedStock').textContent = `${retainedStock.toLocaleString()} Units (${retainedPct.toFixed(1)}%)`;

    const jouriDensity = sim.postEventDensities ? sim.postEventDensities.jouriDensity : (sim.postEventJouriDensity ?? 35.4);
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
  const model = document.getElementById('aiModelSelect')?.value || document.getElementById('drawerModelSelect')?.value || 'auto';

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
                ⚡ Apply & Activate Policy in D1
              </button>
            </div>
          `;
          formattedReply = formattedReply.replace(/\[APPLY_RULE:.*?\]/, buttonHtml);
        } catch (e) {
          console.warn('Rule parse error:', e);
        }
      }
    }

    loadingDiv.innerHTML = `<strong>CARINA Copilot [${data.mode}]:</strong><div>${formattedReply}</div>`;
    history.scrollTop = history.scrollHeight;

    // Attach listener for newly rendered rule buttons in chat
    loadingDiv.querySelectorAll('.btn-apply-rule').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ruleData = JSON.parse(btn.getAttribute('data-rule'));
        btn.disabled = true;
        btn.textContent = 'Activating in D1...';

        try {
          const ruleRes = await fetch('/api/rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ruleData)
          });

          if (ruleRes.ok) {
            btn.textContent = '✅ Policy Active in D1';
            btn.className = 'btn btn-secondary';
            loadStyles();
            loadSummary();
          } else {
            btn.textContent = '❌ Failed to Activate';
          }
        } catch (err) {
          btn.textContent = '❌ Connection Error';
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
      container.innerHTML = '<p style="font-size: 0.8rem; color: var(--text-muted);">No dynamic governance rules registered. Standard Zero-Loss logic applies.</p>';
      return;
    }

    rules.forEach(r => {
      const div = document.createElement('div');
      div.className = 'rule-item';
      div.innerHTML = `
        <div>
          <strong>${r.rule_name}</strong>
          <span style="display:block; font-size: 0.75rem; color: var(--text-muted);">
            Scope: <code>${r.target_scope}</code> | Operator: <code>${r.condition_operator}</code> | Value: <code>${r.rule_value}</code>
          </span>
        </div>
        <span class="badge ${r.enforcement_level === 'HARD_BLOCK' ? 'badge-flag' : 'badge-yes'}">${r.enforcement_level}</span>
      `;
      container.appendChild(div);
    });
  } catch (err) {
    console.error('Rules load error:', err);
  }
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
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

/**
 * CARINA Autonomous Style Lifecycle Monitor & Strategic Discount Planner
 * Modern Interactive Dashboard Controller
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
    
    document.getElementById('stockAndalus').textContent = andalus.stock.toLocaleString() + ' units';
    document.getElementById('densityAndalus').textContent = andalus.density.toFixed(1) + ' u/m²';

    document.getElementById('stockYasmeen').textContent = yasmeen.stock.toLocaleString() + ' units';
    document.getElementById('densityYasmeen').textContent = yasmeen.density.toFixed(1) + ' u/m²';

    document.getElementById('stockJouri').textContent = jouri.stock.toLocaleString() + ' units';
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
        ? '<span class="badge badge-yes">Healthy (&ge;3 Sizes)</span>' 
        : '<span class="badge badge-flag">Broken (&le;2 Sizes)</span>';

      const zeroLossBadge = recommendation.zeroLossStatus === 'YES'
        ? '<span class="badge badge-yes">PASS</span>'
        : '<span class="badge badge-flag">FLAGGED</span>';

      const breakdown = `AND:${metrics.stockAndalus} | YAS:${metrics.stockYasmeen} | JOU:${metrics.stockJouri}`;

      tr.innerHTML = `
        <td><strong>${metrics.styleCode}</strong></td>
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
      const cost = parseFloat(btn.getAttribute('data-cost'));
      const ticket = parseFloat(btn.getAttribute('data-ticket'));
      const promo = parseFloat(btn.getAttribute('data-promo'));
      const discount = parseFloat(btn.getAttribute('data-discount'));
      const stock = parseInt(btn.getAttribute('data-stock'));
      const offer = btn.getAttribute('data-offer');
      const rationale = btn.getAttribute('data-rationale');

      const floor = cost * 1.15;
      const netRevUnit = promo / 1.15;
      const marginUnit = netRevUnit - cost;
      const marginPct = (marginUnit / netRevUnit) * 100;
      const forecastSold = Math.round(stock * 0.40);
      const forecastProfit = Math.round(forecastSold * marginUnit);

      popover.innerHTML = `
        <div class="popover-header">
          <strong>🧮 Offer Derivation & Mathematical Audit</strong>
          <button class="popover-close" id="closePopoverBtn">&times;</button>
        </div>
        <div class="popover-body">
          <div class="popover-title">Style <strong>${styleCode}</strong> — <em>${name}</em></div>
          <div class="popover-sub">Category: <code>${category}</code> | Season: <code>${season}</code></div>
          <div class="popover-section">
            <strong>Commercial Strategy Rationale:</strong>
            <p>${rationale}</p>
          </div>
          <div class="popover-table">
            <div class="pop-row"><span>Unit Landed Cost:</span><strong>${cost.toFixed(2)} SAR</strong></div>
            <div class="pop-row"><span>Saudi 15% VAT Legal Floor:</span><strong>${floor.toFixed(2)} SAR</strong></div>
            <div class="pop-row"><span>Original List Ticket Price:</span><strong>${ticket.toFixed(2)} SAR</strong></div>
            <div class="pop-row highlight"><span>Recommended Promo Price:</span><strong class="text-success">${promo.toFixed(2)} SAR (${discount}% off)</strong></div>
            <div class="pop-row"><span>Unit Net Margin (ex-VAT):</span><strong>+${marginUnit.toFixed(2)} SAR (${marginPct.toFixed(1)}%)</strong></div>
            <div class="pop-row"><span>Forecast Sold (40% clearance):</span><strong>${forecastSold} units</strong></div>
            <div class="pop-row highlight"><span>Projected Net Cash Margin:</span><strong class="text-success">+${forecastProfit.toLocaleString()} SAR</strong></div>
            <div class="pop-row"><span>Legal Floor Status:</span><span class="badge badge-yes">PASS (${promo.toFixed(2)} &ge; ${floor.toFixed(2)} SAR)</span></div>
          </div>
        </div>
      `;

      // Position popover next to button
      const rect = btn.getBoundingClientRect();
      popover.style.display = 'block';
      popover.style.top = `${rect.bottom + window.scrollY + 6}px`;
      popover.style.left = `${Math.min(rect.left + window.scrollX - 180, window.innerWidth - 440)}px`;

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
        Zero-Loss Floor (Cost + 15% VAT): <strong style="color: var(--accent-amber);">${floor} SAR</strong> | 
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
  const targetLiquidation = parseInt(document.getElementById('sliderLiquidation').value);
  const marginFloor = parseFloat(document.getElementById('sliderMarginFloor').value);

  try {
    const res = await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLiquidation, marginFloor })
    });
    if (!res.ok) return;
    const sim = await res.json();

    document.getElementById('simGrossRev').textContent = Math.round(sim.projectedGrossRevenue).toLocaleString() + ' SAR';
    document.getElementById('simNetProfit').textContent = Math.round(sim.projectedNetProfit).toLocaleString() + ' SAR';
    document.getElementById('simRealizedMargin').textContent = sim.realizedNetMarginPct.toFixed(1) + '%';
    document.getElementById('simRetainedStock').textContent = `${sim.retainedWinterUnits.toLocaleString()} Units (${sim.retainedWinterPct.toFixed(1)}%)`;

    const jouriVal = document.getElementById('simJouriPostDensity');
    jouriVal.textContent = `${sim.postEventJouriDensity.toFixed(1)} u/m² (${sim.jouriStatus})`;
    jouriVal.className = sim.jouriStatus === 'CLEAR' ? 'text-success' : 'text-danger';
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
              <button class="btn btn-primary btn-apply-rule" data-rule='${escapeHtml(JSON.stringify(ruleObj))}'>
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
 * Loads active governance rules into modal.
 */
async function loadRules() {
  const container = document.getElementById('activeRulesList');
  try {
    const res = await fetch('/api/rules');
    if (!res.ok) return;
    const rules = await res.json();

    container.innerHTML = '';
    rules.forEach(r => {
      const div = document.createElement('div');
      div.className = 'rule-item';
      div.innerHTML = `
        <div>
          <strong>${r.rule_name}</strong><br>
          <small>Scope: <code>${r.target_scope}</code> | Condition: <code>${r.condition_operator} ${r.rule_value}</code></small>
        </div>
        <span class="badge badge-yes">${r.enforcement_level}</span>
      `;
      container.appendChild(div);
    });
  } catch (err) {
    console.error('Rules load error:', err);
  }
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max) + '...' : str;
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/### (.*?)\n/g, '<h4 class="chat-h4">$1</h4>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/• (.*?)\n/g, '<li>$1</li>')
    .replace(/(<li>.*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/\n\n/g, '<br><br>');
}

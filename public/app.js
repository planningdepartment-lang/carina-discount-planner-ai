// CARINA Discount Planner - Interactive Frontend Application

let currentPage = 1;
const pageSize = 50;
let debounceTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  initSummary();
  loadStyles();
  loadRules();
  setupEventListeners();
});

function setupEventListeners() {
  // Search & Filter Inputs
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
    const pct = ((units / 52732) * 100).toFixed(1);
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

  // Copilot Drawer
  const copilotDrawer = document.getElementById('copilotDrawer');
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
        alert('Rule successfully activated in Cloudflare D1!');
        document.getElementById('newRuleForm').reset();
        loadRules();
        loadStyles(); // Refresh styles with new rule
      }
    } catch (err) {
      console.error('Error saving rule:', err);
    }
  });

  // Export CSV
  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    window.location.href = '/api/export/pos-csv';
  });
}

/**
 * Loads KPI ribbons and physical store densities.
 */
async function initSummary() {
  try {
    const res = await fetch('/api/metrics/summary');
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('kpiTotalStock').textContent = data.totalPhysicalStock.toLocaleString() + ' u';
    document.getElementById('kpiTotalCost').textContent = (data.totalCostCapitalSAR / 1e6).toFixed(2) + 'M SAR';
    document.getElementById('kpiRetailValue').textContent = (data.totalRetailValueSAR / 1e6).toFixed(2) + 'M SAR';
    document.getElementById('kpiBlendedIMU').textContent = data.blendedIMU.toFixed(1) + '%';
    document.getElementById('kpiCurveHealth').textContent = `${data.healthyCurvesCount} / ${data.activeStylesCount} Styles`;

    // Store Densities
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
 * Loads paginated styles with search and category filters.
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
        <td><span class="offer-pill">${recommendation.recommendedOffer}</span></td>
        <td>${recommendation.discountPct.toFixed(0)}%</td>
        <td><strong class="text-success">${recommendation.promotionalPriceSAR.toFixed(2)} SAR</strong></td>
        <td>${zeroLossBadge}</td>
        <td><small title="${recommendation.rationale}">${truncate(recommendation.rationale, 45)}</small></td>
      `;
      tbody.appendChild(tr);
    });

    const startIdx = (currentPage - 1) * pageSize + 1;
    const endIdx = Math.min(result.total, currentPage * pageSize);
    document.getElementById('pageInfo').textContent = `Showing styles ${startIdx} to ${endIdx} of ${result.total}`;
  } catch (err) {
    console.error('Styles load error:', err);
  }
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
      body: JSON.stringify({
        targetLiquidationUnits: targetLiquidation,
        minimumNetMarginFloorPct: marginFloor
      })
    });
    if (!res.ok) return;
    const sim = await res.json();

    document.getElementById('simGrossRev').textContent = sim.projectedGrossRevenue.toLocaleString() + ' SAR';
    document.getElementById('simNetProfit').textContent = sim.projectedGrossProfit.toLocaleString() + ' SAR';
    document.getElementById('simRealizedMargin').textContent = sim.realizedMarginPct.toFixed(1) + '%';
    document.getElementById('simRetainedStock').textContent = `${sim.retainedStockUnits.toLocaleString()} Units (${sim.retainedStockPct.toFixed(1)}%)`;
    document.getElementById('simJouriPostDensity').textContent = `${sim.postEventDensities.jouriDensity.toFixed(1)} u/m² (Clean)`;
  } catch (err) {
    console.error('Simulation error:', err);
  }
}

/**
 * Handles Copilot chat queries.
 */
async function submitCopilotChat(message) {
  const history = document.getElementById('chatHistory');
  const mode = document.getElementById('agentModeSelect').value;

  // Add User bubble
  const userDiv = document.createElement('div');
  userDiv.className = 'chat-bubble user';
  userDiv.innerHTML = `<p>${escapeHtml(message)}</p>`;
  history.appendChild(userDiv);
  history.scrollTop = history.scrollHeight;

  // Add Loading indicator
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'chat-bubble ai';
  loadingDiv.textContent = 'Thinking with Workers AI...';
  history.appendChild(loadingDiv);
  history.scrollTop = history.scrollHeight;

  try {
    const res = await fetch('/api/copilot/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, mode })
    });
    const data = await res.json();

    loadingDiv.innerHTML = `<strong>CARINA Copilot [${data.mode}]:</strong><p>${formatMarkdown(data.reply)}</p>`;
    history.scrollTop = history.scrollHeight;
  } catch (err) {
    loadingDiv.textContent = 'Failed to connect to Cloudflare Workers AI.';
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
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

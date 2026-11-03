import { calculateModel, EXCEL_DEFAULTS, FIXED, PNL_ROWS, CASH_ROWS } from './model.js';
import { calculateScenario, defaultAllScenarioParameters, defaultScenarioParameters, SCENARIO_DEFINITIONS, SCENARIO_DRIVERS } from './scenarios.js';
import { loadScenarioParameters, saveScenarioParameters } from './scenario-storage.js';
import { fetchGoogleSourceInputs } from './google-sheets-sync.js';
import { calculateTornado, calculateWhatIf, SENSITIVITY_PARAMETERS } from './sensitivity.js';
import { calculateExpenseStructure } from './expense-structure.js';
import { renderAnalyticalNotePage } from './analytical-note-ui.js';

const $ = (selector) => document.querySelector(selector);
const inputIds = {
  startDate: '#start-date', horizon: '#horizon', traffic: '#traffic', conversion: '#conversion',
  averageCheck: '#basket', hoursPerDay: '#hours', operatingDays: '#days', rawCogsShare: '#cogs', marketing: '#marketing',
};
const seriesColors = { revenue: '#d9bd82', ebitda: '#61c6a2', profit: '#f2e6cf', cash: '#7bd7b1' };
let selectedIndex = 0;
let model;
let toastTimer;
let sourceDefaults = { ...EXCEL_DEFAULTS, payroll: FIXED.payroll };
function browserStorage() {
  try { return window.localStorage; } catch { return null; }
}
let scenarioParameters = loadScenarioParameters(browserStorage());
let storageWarningShown = false;
const dashboardOverrides = new Set();
let scenarioControlsInitialized = false;
let pendingGoogleInputs = null;
let sensitivityMatrixView = 'table';
let sensitivityAnalysis = null;

function readInput() {
  const conversionPct = Number($(inputIds.conversion).value);
  const cogsPct = Number($(inputIds.rawCogsShare).value);
  return {
    startDate: $(inputIds.startDate).value || EXCEL_DEFAULTS.startDate,
    horizon: Number($(inputIds.horizon).value),
    traffic: Number($(inputIds.traffic).value),
    conversion: conversionPct / 100,
    averageCheck: Number($(inputIds.averageCheck).value),
    hoursPerDay: Number($(inputIds.hoursPerDay).value),
    operatingDays: Number($(inputIds.operatingDays).value),
    rawCogsShare: cogsPct / 100,
    marketing: Number($(inputIds.marketing).value),
    payroll: sourceDefaults.payroll,
  };
}

function formatMoney(value, decimals = 0) {
  if (value === null || !Number.isFinite(value)) return 'Ошибка: деление на ноль';
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(value)} ₽`;
}

function monthWord(value) {
  const lastTwo = value % 100;
  const last = value % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'месяцев';
  if (last === 1) return 'месяц';
  if (last >= 2 && last <= 4) return 'месяца';
  return 'месяцев';
}

function formatPercent(value) {
  if (value === null || !Number.isFinite(value)) return 'Ошибка: деление на ноль';
  return `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value * 100)}%`;
}

function formatChartMoney(value) {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(abs / 1_000_000)} млн`;
  if (abs >= 1_000) return `${sign}${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(abs / 1_000)} тыс.`;
  return `${sign}${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(abs)} ₽`;
}

function signClass(value) {
  if (!Number.isFinite(value)) return 'is-error';
  return value < 0 ? 'is-negative' : 'is-positive';
}

function cardMarkup({ title, value, formatted, unit, hint, valueTone = 'is-positive', secondary = '' }) {
  return `<article class="kpi-card">
    <div class="kpi-card-top"><span class="kpi-label">${title}</span><button class="info-button" type="button" aria-label="Информация: ${title}" aria-expanded="false"><span>i</span><span class="popover" role="tooltip">${hint}</span></button></div>
    <div class="kpi-value ${valueTone}">${formatted}</div>
    <div class="kpi-foot"><span>${unit}</span>${secondary ? `<span class="kpi-secondary">${secondary}</span>` : ''}</div>
  </article>`;
}

const hints = {
  revenue: 'Выручка — все продажи за период. В Excel строка 26 считается как трафик × часы работы × рабочие дни × конверсия × средний чек. Здесь показана сумма за горизонт, делённая на число месяцев, или выбранный месяц. Помогает оценить типичный объём продаж.',
  gross: 'Валовая прибыль — выручка за вычетом себестоимости строк 27–30. Для среднемесячного режима показываем сумму за горизонт, делённую на число месяцев. Помогает понять, сколько остаётся после прямых затрат на товары.',
  grossMargin: 'Доля выручки, остающаяся после себестоимости. Рассчитывается как суммарная валовая прибыль / суммарная выручка за горизонт (или как показатель выбранного месяца). Это взвешенная доля, не среднее процентов по месяцам.',
  ebitda: 'Прибыль до амортизации, процентов и налогов: валовая прибыль минус комиссии агрегаторов и операционные расходы по формулам Excel. В среднемесячном режиме это сумма EBITDA за период / число месяцев. Показывает результат основной деятельности до ряда неденежных и финансовых статей.',
  profit: 'Чистая прибыль после амортизации, финансовых расходов и налога УСН по формулам Excel. Для среднемесячного режима это сумма за горизонт / число месяцев. Помогает оценить бухгалтерский результат бизнеса.',
  netMargin: 'Чистая прибыль как доля выручки. Для всего горизонта рассчитывается суммарная чистая прибыль / суммарная выручка. Показывает, сколько прибыли приходится на рубль продаж.',
  npv: 'NPV за весь горизонт: денежный поток первого месяца плюс потоки следующих месяцев, дисконтированные по месячной ставке, которую Excel выводит из годовой ставки 30%. Положительное значение означает, что сумма дисконтированных потоков выше нуля при этой ставке. Это расчёт исходной модели, не гарантия доходности.',
  payback: 'Excel показывает первый месяц, когда накопленный чистый поток ДДС становится больше нуля. При исходных параметрах CAPEX 1 061 500 ₽ включён в тот же первый месяц, что и выручка; операционный поток превышает CAPEX, поэтому накопленный поток положителен уже в месяце 1, а расчётная потребность в инвестициях равна 0 ₽. Это трактовка месячной модели, а не подтверждение возврата отдельно внесённого CAPEX до появления выручки.',
  investment: 'Потребность по Excel = максимум из нуля и модуля минимального накопленного денежного потока за горизонт. При исходных параметрах получается 0 ₽: вложение CAPEX и поступления первого месяца объединены, и кассового разрыва в месячных итогах нет. Внутримесячную потребность до получения выручки эта формула не показывает.',
};

function renderKpis() {
  const period = model.periods[selectedIndex] || model.periods[0];
  const averageMode = $('#selected-period').value === 'average';
  const horizon = model.periods.length;
  const sum = (row) => model.periods.reduce((total, item) => total + (item.pnl[row] || 0), 0);
  const average = (row) => sum(row) / horizon;
  const revenue = sum(26);
  const displayed = (row) => averageMode ? average(row) : period.pnl[row];
  const displayedRatio = (row) => averageMode ? (revenue === 0 ? null : sum(row) / revenue) : period.pnl[row];
  const kpiPeriod = averageMode ? `среднее за ${horizon} мес.` : period.fullLabel;
  const values = [
    { title: 'Среднемесячная выручка', formatted: formatMoney(displayed(26)), value: displayed(26), unit: kpiPeriod, hint: hints.revenue },
    { title: 'Среднемесячная валовая прибыль', formatted: formatMoney(displayed(32)), value: displayed(32), unit: kpiPeriod, hint: hints.gross },
    { title: 'Валовая рентабельность', formatted: formatPercent(displayedRatio(32)), value: displayedRatio(32), unit: 'валовая прибыль / выручка', hint: hints.grossMargin },
    { title: 'Среднемесячная EBITDA', formatted: formatMoney(displayed(41)), value: displayed(41), unit: kpiPeriod, hint: hints.ebitda },
    { title: 'Среднемесячная чистая прибыль', formatted: formatMoney(displayed(46)), value: displayed(46), unit: kpiPeriod, hint: hints.profit },
    { title: 'Чистая рентабельность', formatted: formatPercent(displayedRatio(46)), value: displayedRatio(46), unit: 'чистая прибыль / выручка', hint: hints.netMargin },
    { title: 'NPV', formatted: formatMoney(model.npv), value: model.npv, unit: 'за весь горизонт', hint: hints.npv },
    { title: 'Срок окупаемости', formatted: model.paybackMonth === null ? 'Не окупается' : `${model.paybackMonth} мес.`, value: model.paybackMonth, unit: model.paybackMonth === null ? 'в пределах горизонта' : model.periods[model.paybackMonth - 1].fullLabel, hint: hints.payback, valueTone: model.paybackMonth === null ? 'is-neutral' : 'is-positive' },
    { title: 'Потребность в инвестициях', formatted: formatMoney(model.investmentNeed), value: model.investmentNeed, unit: 'максимальный кассовый разрыв', hint: hints.investment },
  ];
  $('#kpi-grid').innerHTML = values.map((entry) => cardMarkup({ ...entry, valueTone: entry.valueTone || signClass(entry.value) })).join('');
  wireInfoButtons();
  $('#chart-period-note').textContent = `${model.periods.length} мес. · ${model.periods[0].label} — ${model.periods.at(-1).label}`;
  $('#payback-caption').textContent = model.paybackMonth === null
    ? 'За период наблюдения накопленный поток не стал положительным.'
    : `Положительный накопленный поток впервые зафиксирован в ${model.periods[model.paybackMonth - 1].fullLabel.toLowerCase()} (месяц ${model.paybackMonth}). При нулевой потребности в инвестициях по Excel это означает отсутствие кассового разрыва в месячных итогах; вложенный CAPEX отдельно до выручки не проверяется.`;
}

function svgText(x, y, text, className = '', anchor = 'middle') {
  return `<text x="${x}" y="${y}" class="${className}" text-anchor="${anchor}">${text}</text>`;
}

function chartBase(periods, values, { includeZero = true, formatAxis = formatChartMoney, width = 760 } = {}) {
  const height = 286;
  const pad = { left: 88, right: 18, top: 16, bottom: 46 };
  const all = values.flat().filter(Number.isFinite);
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (includeZero) { min = Math.min(0, min); max = Math.max(0, max); }
  if (min === max) { min -= 1; max += 1; }
  const spread = max - min;
  min -= spread * 0.08;
  max += spread * 0.08;
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const x = (index) => pad.left + (periods.length === 1 ? plotWidth / 2 : (index / (periods.length - 1)) * plotWidth);
  const y = (value) => pad.top + (1 - (value - min) / (max - min)) * plotHeight;
  let grid = '';
  for (let index = 0; index <= 4; index += 1) {
    const value = min + (max - min) * index / 4;
    const yy = y(value);
    grid += `<line class="chart-grid-line" x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}" />${svgText(pad.left - 10, yy + 4, formatAxis(value), 'chart-axis-label', 'end')}`;
  }
  const tickCount = Math.max(3, Math.floor(width / 140));
  const tickStep = periods.length <= tickCount ? 1 : Math.ceil(periods.length / tickCount);
  let ticks = '';
  periods.forEach((period, index) => {
    if (index % tickStep === 0 || index === periods.length - 1) {
      ticks += svgText(x(index), height - 10, period.label.replace(' г.', ''), 'chart-x-label');
    }
  });
  const zeroY = min <= 0 && max >= 0 ? `<line class="zero-line" x1="${pad.left}" y1="${y(0)}" x2="${width - pad.right}" y2="${y(0)}" />` : '';
  return { width, height, pad, x, y, grid, ticks, zeroY, plotWidth, plotHeight };
}

function renderLineChart(target, series, periods, accessibleLabel) {
  const chart = chartBase(periods, series.map((item) => item.values), { width: Math.max(320, target.clientWidth || 760) });
  let drawings = '';
  series.forEach((item) => {
    const points = item.values.map((value, index) => `${chart.x(index)},${chart.y(value)}`).join(' ');
    drawings += `<polyline class="series-line" points="${points}" stroke="${item.color}" />`;
    item.values.forEach((value, index) => {
      const label = `${periods[index].fullLabel}: ${item.name.toLowerCase()} — ${formatMoney(value)}`;
      drawings += `<circle class="series-point" data-value="${value}" cx="${chart.x(index)}" cy="${chart.y(value)}" r="3.7" fill="${item.color}" tabindex="0" aria-label="${label}"><title>${label}</title></circle>`;
    });
  });
  target.innerHTML = `<svg class="data-chart" viewBox="0 0 ${chart.width} ${chart.height}" role="img" aria-label="${accessibleLabel}"><g>${chart.grid}${chart.zeroY}${chart.ticks}${drawings}</g></svg>`;
}

function renderCashChart(target, periods) {
  renderLineChart(target, [{ name: 'Накопленный поток', color: seriesColors.cash, values: periods.map((period) => period.cash[65]) }], periods, 'График накопленного денежного потока по месяцам с нулевой линией');
}

function renderPaybackChart(target, periods) {
  const values = periods.map((period) => period.cash[65]);
  const chart = chartBase(periods, [values], { width: Math.max(320, target.clientWidth || 760) });
  const zeroY = chart.y(0);
  const band = chart.plotWidth / periods.length;
  const barWidth = Math.max(5, Math.min(24, band * 0.54));
  let bars = '';
  values.forEach((value, index) => {
    const top = Math.min(chart.y(value), zeroY);
    const barHeight = Math.max(1, Math.abs(chart.y(value) - zeroY));
    const color = value < 0 ? '#FF4D4F' : (model.paybackMonth === index + 1 ? '#d8bd83' : '#65bf9b');
    const label = `${periods[index].fullLabel}: накопленный поток — ${formatMoney(value)}${model.paybackMonth === index + 1 ? ', месяц окупаемости по Excel' : ''}`;
    bars += `<rect class="payback-bar" data-value="${value}" x="${chart.x(index) - barWidth / 2}" y="${top}" width="${barWidth}" height="${barHeight}" rx="3" fill="${color}" tabindex="0" aria-label="${label}"><title>${label}</title></rect>`;
  });
  target.innerHTML = `<svg class="data-chart" viewBox="0 0 ${chart.width} ${chart.height}" role="img" aria-label="Столбчатая диаграмма накопленного денежного потока по месяцам"><g>${chart.grid}${chart.zeroY}${chart.ticks}${bars}</g></svg>`;
}

function renderCharts() {
  const periods = model.periods;
  $('#pnl-legend').innerHTML = `<span><i class="legend-line legend-revenue"></i> Выручка</span><span><i class="legend-line legend-ebitda"></i> EBITDA</span><span><i class="legend-line legend-profit"></i> Чистая прибыль</span>`;
  renderLineChart($('#pnl-chart'), [
    { name: 'Выручка', color: seriesColors.revenue, values: periods.map((period) => period.pnl[26]) },
    { name: 'EBITDA', color: seriesColors.ebitda, values: periods.map((period) => period.pnl[41]) },
    { name: 'Чистая прибыль', color: seriesColors.profit, values: periods.map((period) => period.pnl[46]) },
  ], periods, 'Динамика выручки, EBITDA и чистой прибыли по месяцам');
  renderCashChart($('#cash-chart'), periods);
  renderPaybackChart($('#payback-chart'), periods);
  wireChartTooltips();
}

function prepareExpensePeriodOptions() {
  const select = $('#expense-period');
  const previous = select.value || 'total';
  const months = model.periods.map((period, index) => `<option value="month:${index}">${period.fullLabel}</option>`).join('');
  select.innerHTML = `<option value="total">Весь горизонт · ${model.periods.length} ${monthWord(model.periods.length)}</option>${months}`;
  select.value = [...select.options].some((option) => option.value === previous) ? previous : 'total';
}

function formatExpenseMoney(value) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)} ₽`;
}

function renderExpenseStructure() {
  const target = $('#expense-donut');
  if (!target) return;
  prepareExpensePeriodOptions();
  const period = $('#expense-period').value;
  const structure = calculateExpenseStructure(model, period);
  const cx = 145;
  const cy = 137;
  const radius = 91;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  let slices = '';
  structure.categories.forEach((category) => {
    if (category.amount <= 0 || structure.total <= 0) return;
    const arcLength = circumference * category.amount / structure.total;
    const visibleLength = Math.max(0, arcLength - Math.min(2.2, arcLength * 0.24));
    const share = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(category.share);
    const label = `${category.label}: ${formatExpenseMoney(category.amount)} · ${share}%`;
    slices += `<circle class="expense-slice" cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${category.color}" stroke-width="34" stroke-dasharray="${visibleLength} ${circumference - visibleLength}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})" tabindex="0" data-value="${category.amount}" aria-label="${label}"><title>${label}</title></circle>`;
    offset += arcLength;
  });
  const emptyState = structure.total === 0 ? `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="rgba(242,230,207,.12)" stroke-width="34" />` : '';
  const periodLabel = period === 'total' ? `весь горизонт · ${structure.periodsCount} ${monthWord(structure.periodsCount)}` : `за ${model.periods[Number(period.split(':')[1])].fullLabel.toLowerCase()}`;
  target.innerHTML = `<svg class="expense-donut" viewBox="0 0 290 276" role="img" aria-label="Кольцевая диаграмма структуры расходов за ${periodLabel}"><g>${emptyState}${slices}</g><text x="${cx}" y="${cy - 2}" class="expense-donut-total">${formatMoney(structure.total)}</text><text x="${cx}" y="${cy + 22}" class="expense-donut-label">Всего расходов</text></svg>`;
  $('#expense-legend').innerHTML = structure.categories.map((category) => {
    const share = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(category.share);
    const label = `${category.label}: ${formatExpenseMoney(category.amount)} · ${share}%`;
    return `<button type="button" class="expense-legend-item expense-legend-hit" data-value="${category.amount}" aria-label="${label}"><i style="--expense-color:${category.color}"></i><span>${category.label}</span><strong>${formatExpenseMoney(category.amount)}</strong><em>${share}%</em></button>`;
  }).join('');
  $('#expense-largest').textContent = structure.largest
    ? `Наибольшая статья — ${structure.largest.label}: ${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(structure.largest.share)}% расходов.`
    : 'В выбранном периоде нет расходов.';
  wireChartTooltips();
}

function wireChartTooltips() {
  let tooltip = $('#chart-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'chart-tooltip';
    tooltip.className = 'chart-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    document.body.append(tooltip);
  }
  document.querySelectorAll('.series-point, .payback-bar, .scenario-bar, .scenario-comparison-group, .sensitivity-hit, .expense-slice, .expense-legend-hit').forEach((point) => {
    if (point.dataset.tooltipBound === 'true') return;
    point.dataset.tooltipBound = 'true';
    const show = () => {
      if (point.classList.contains('sensitivity-tornado-hit')) {
        tooltip.classList.add('is-tornado-tooltip');
        tooltip.classList.remove('is-scenario-comparison');
        tooltip.classList.remove('is-negative');
        renderTornadoTooltip(tooltip, point);
      } else if (point.classList.contains('scenario-comparison-group')) {
        tooltip.innerHTML = point.dataset.tooltipHtml;
        tooltip.classList.remove('is-tornado-tooltip');
        tooltip.classList.add('is-scenario-comparison');
        tooltip.classList.remove('is-negative');
      } else {
        tooltip.textContent = point.getAttribute('aria-label');
        tooltip.classList.remove('is-tornado-tooltip');
        tooltip.classList.remove('is-scenario-comparison');
        tooltip.classList.toggle('is-negative', Number(point.dataset.value) < 0);
      }
      tooltip.classList.add('is-visible');
      const rect = point.getBoundingClientRect();
      const tipRect = tooltip.getBoundingClientRect();
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - tipRect.width - 12));
      const top = rect.top - tipRect.height - 9 >= 12 ? rect.top - tipRect.height - 9 : Math.min(rect.bottom + 9, window.innerHeight - tipRect.height - 12);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${Math.max(12, top)}px`;
    };
    const hide = () => {
      if (point.dataset.tooltipPinned === 'true') return;
      tooltip.classList.remove('is-visible');
    };
    point.addEventListener('mouseenter', show);
    point.addEventListener('mouseleave', hide);
    point.addEventListener('focus', show);
    point.addEventListener('blur', hide);
    point.addEventListener('click', (event) => {
      event.stopPropagation();
      const wasPinned = point.dataset.tooltipPinned === 'true';
      document.querySelectorAll('[data-tooltip-pinned="true"]').forEach((item) => delete item.dataset.tooltipPinned);
      if (wasPinned) tooltip.classList.remove('is-visible');
      else {
        point.dataset.tooltipPinned = 'true';
        show();
      }
    });
  });
}

document.addEventListener('click', (event) => {
  if (event.target.closest('.series-point, .payback-bar, .scenario-bar, .scenario-comparison-group, .sensitivity-hit, .expense-slice, .expense-legend-hit')) return;
  document.querySelectorAll('[data-tooltip-pinned="true"]').forEach((item) => delete item.dataset.tooltipPinned);
  $('#chart-tooltip')?.classList.remove('is-visible');
});

function renderTornadoTooltip(tooltip, point) {
  const heading = document.createElement('strong');
  heading.className = 'tornado-tooltip-title';
  heading.textContent = point.dataset.parameter;
  const rows = [
    ['Исходное значение', point.dataset.base],
    ['Новое значение', point.dataset.next],
    ['Изменение параметра', point.dataset.direction],
    ['Чистая прибыль', point.dataset.profit],
  ];
  tooltip.replaceChildren(heading);
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'tornado-tooltip-row';
    const name = document.createElement('span');
    name.textContent = label;
    const result = document.createElement('b');
    result.textContent = value;
    row.append(name, result);
    tooltip.append(row);
  }
  const delta = document.createElement('div');
  delta.className = `tornado-tooltip-delta${point.dataset.deltaTone ? ` ${point.dataset.deltaTone}` : ''}`;
  delta.textContent = `Изменение прибыли: ${point.dataset.delta}`;
  tooltip.append(delta);
  if (point.dataset.note) {
    const note = document.createElement('small');
    note.className = 'tornado-tooltip-note';
    note.textContent = point.dataset.note;
    tooltip.append(note);
  }
}

const scenarioMetricRows = [
  { id: 'revenue', label: 'Выручка за горизонт', format: 'money', hint: 'Сумма выручки по строке 26 ОПиУ за весь горизонт. Показывает общий объём продаж сценария.' },
  { id: 'grossProfit', label: 'Валовая прибыль за горизонт', format: 'money', hint: 'Сумма валовой прибыли по строке 32 ОПиУ после себестоимости из формул основного листа «Финмодель».' },
  { id: 'ebitda', label: 'EBITDA за горизонт', format: 'money', hint: 'Сумма EBITDA по строке 41 ОПиУ: валовая прибыль после комиссии агрегаторов и операционных расходов.' },
  { id: 'netProfit', label: 'Чистая прибыль за горизонт', format: 'money', hint: 'Сумма чистой прибыли по строке 46 ОПиУ после амортизации и налога УСН.' },
  { id: 'netMargin', label: 'Чистая рентабельность', format: 'percent', hint: 'Суммарная чистая прибыль / суммарная выручка за горизонт. Это взвешенная рентабельность, а не среднее месячных процентов.' },
  { id: 'npv', label: 'NPV за горизонт', format: 'money', hint: 'Сумма чистых денежных потоков с дисконтированием по ставке из исходной Excel-модели. Положительный результат при прочих равных означает превышение дисконтированными поступлениями вложений.' },
  { id: 'investmentNeed', label: 'Потребность в инвестициях', format: 'money', hint: 'Максимальный отрицательный накопленный денежный поток по строке 65 ДДС за горизонт. Не показывает порядок поступлений и платежей внутри месяца.' },
  { id: 'paybackMonth', label: 'Окупаемость по месячному ДДС', format: 'month', hint: 'Первый месяц, в конце которого накопленный денежный поток строки 65 становится положительным. CAPEX и операции месяца сведены в один итог; точный день возврата инвестиций Excel не вычисляет.' },
];

const driverHints = {
  traffic: 'Количество посетителей за один час. Вместе с часами работы, рабочими днями, конверсией и средним чеком определяет выручку.',
  conversionPercent: 'Доля посетителей, которые совершают покупку. Введите процент, например 25 или 30.',
  averageCheck: 'Средняя сумма одной покупки в рублях. Влияет на выручку вместе с количеством покупок.',
  rawCogsSharePercent: 'Доля затрат на сырьё в выручке. Введите процент, например 35 или 40.',
  payroll: 'Расходы на фонд оплаты труда за месяц. Эта сумма участвует в ОПиУ и выплатах ФОТ в ДДС.',
};

function formatScenarioMetric(metric, value) {
  if (metric.format === 'percent') return formatPercent(value);
  if (metric.format === 'month') return value === null ? 'Не окупается' : `${value} мес.`;
  return formatMoney(value);
}

function renderScenarioControls() {
  $('#scenario-controls').innerHTML = SCENARIO_DEFINITIONS.map((scenario) => `
    <article class="scenario-control-card" style="--scenario-color:${scenario.color}">
      <div class="scenario-control-heading"><div><span class="scenario-swatch"></span><h3>${scenario.label}</h3></div><div class="scenario-control-actions">${scenario.id === 'base' ? '<button class="reset-button scenario-copy-main" type="button" data-copy-main-scenario>Взять параметры основной модели</button>' : ''}<button class="reset-button scenario-reset" type="button" data-scenario-reset="${scenario.id}">Сбросить значения</button></div></div>
      <p>Помесячный расчёт · ${sourceDefaults.horizon} ${monthWord(sourceDefaults.horizon)}</p>
      <div class="scenario-driver-list">${SCENARIO_DRIVERS.map((driver) => `<label class="scenario-driver" for="scenario-${scenario.id}-${driver.id}"><span>${driver.label}<button class="hint-button" type="button" aria-label="Подсказка: ${driver.label}" data-hint="${driverHints[driver.id]}">i</button></span><span class="scenario-driver-input"><input id="scenario-${scenario.id}-${driver.id}" type="number" min="${driver.min}" ${driver.max === undefined ? '' : `max="${driver.max}"`} step="${driver.step}" value="${scenarioParameters[scenario.id][driver.id]}" data-scenario="${scenario.id}" data-driver="${driver.id}" /><em>${driver.unit}</em></span></label>`).join('')}</div>
    </article>`).join('');
}

function renderScenarioTable(results) {
  const columns = SCENARIO_DEFINITIONS.map((scenario) => `<th scope="col"><span class="scenario-heading-label" style="--scenario-color:${scenario.color}">${scenario.label}</span></th>`).join('');
  const baseline = calculateScenario();
  const body = scenarioMetricRows.map((metric) => {
    const baselineValue = baseline.metrics[metric.id];
    const cells = [baseline, ...SCENARIO_DEFINITIONS.map((scenario) => results[scenario.id])].map((result, index) => {
      const value = result.metrics[metric.id];
      const tone = typeof value === 'number' && value < 0 ? 'is-negative' : typeof value === 'number' ? 'is-positive' : 'is-neutral';
      const different = index > 0 && typeof value === 'number' && typeof baselineValue === 'number'
        ? Math.abs(value - baselineValue) > 1e-8
        : index > 0 && value !== baselineValue;
      return `<td class="${tone}${different ? ' is-different' : ''}">${formatScenarioMetric(metric, value)}</td>`;
    }).join('');
    return `<tr class="${metric.id === 'npv' || metric.id === 'paybackMonth' ? 'row-key' : ''}"><th scope="row">${metric.label}<button class="hint-button" type="button" aria-label="Подсказка: ${metric.label}" data-hint="${metric.hint}">i</button></th>${cells}</tr>`;
  }).join('');
  $('#scenario-comparison').innerHTML = `<div class="scenario-table-scroll"><table class="scenario-table"><caption>Денежные значения — за полный горизонт в рублях · рентабельность — за период целиком</caption><thead><tr><th scope="col">Показатель</th><th scope="col">Исходный Excel</th>${columns}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderScenarioLineChart(target, series, periods, accessibleLabel) {
  const chart = chartBase(periods, series.map((item) => item.values), { width: Math.max(320, target.clientWidth || 760) });
  let drawings = '';
  series.forEach((item) => {
    const points = item.values.map((value, index) => `${chart.x(index)},${chart.y(value)}`).join(' ');
    drawings += `<polyline class="series-line" points="${points}" stroke="${item.color}" />`;
    item.values.forEach((value, index) => {
      const label = `${item.name} · ${periods[index].fullLabel} · ${formatMoney(value)}`;
      drawings += `<circle class="series-point" data-value="${value}" cx="${chart.x(index)}" cy="${chart.y(value)}" r="3.8" fill="${item.color}" tabindex="0" aria-label="${label}"><title>${label}</title></circle>`;
    });
  });
  target.innerHTML = `<svg class="data-chart" viewBox="0 0 ${chart.width} ${chart.height}" role="img" aria-label="${accessibleLabel}"><g>${chart.grid}${chart.zeroY}${chart.ticks}${drawings}</g></svg>`;
}

function formatScenarioAxisMoney(value) {
  const abs = Math.abs(value);
  const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  const sign = value < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}${number.format(abs / 1_000_000)} млн ₽`;
  if (abs >= 1_000) return `${sign}${number.format(abs / 1_000)} тыс. ₽`;
  return `${sign}${number.format(abs)} ₽`;
}

function renderScenarioSummaryChart(target) {
  const metrics = [
    { id: 'revenue', label: ['Выручка'] },
    { id: 'ebitda', label: ['EBITDA'] },
    { id: 'netProfit', label: ['Чистая', 'прибыль'] },
    { id: 'npv', label: ['NPV'] },
  ];
  const width = Math.max(360, target.clientWidth || 900);
  const height = 390;
  const pad = { left: 104, right: 22, top: 20, bottom: 66 };
  const plotBottom = height - pad.bottom;
  const plotHeight = plotBottom - pad.top;
  const values = metrics.flatMap((metric) => SCENARIO_DEFINITIONS.map((scenario) => scenarioResults[scenario.id].metrics[metric.id]));
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) { min -= 1; max += 1; }
  const extra = (max - min) * 0.08;
  min -= extra;
  max += extra;
  const y = (value) => pad.top + (max - value) / (max - min) * plotHeight;
  const zeroY = y(0);
  const plotWidth = width - pad.left - pad.right;
  const groupStep = plotWidth / metrics.length;
  const groupWidth = groupStep * 0.72;
  const barGap = Math.max(4, Math.min(10, groupWidth * 0.06));
  const barWidth = (groupWidth - barGap * 2) / SCENARIO_DEFINITIONS.length;
  let grid = '';
  let labels = '';
  for (let tick = 0; tick <= 5; tick += 1) {
    const value = min + (max - min) * tick / 5;
    const yy = y(value);
    grid += `<line class="chart-grid-line" x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}" />${svgText(pad.left - 11, yy + 4, formatScenarioAxisMoney(value), 'chart-axis-label', 'end')}`;
  }
  grid += `<line class="zero-line scenario-summary-zero" x1="${pad.left}" y1="${zeroY}" x2="${width - pad.right}" y2="${zeroY}" />`;

  metrics.forEach((metric, metricIndex) => {
    const center = pad.left + groupStep * (metricIndex + 0.5);
    const xStart = center - groupWidth / 2;
    const scenarioValues = SCENARIO_DEFINITIONS.map((scenario) => ({ scenario, value: scenarioResults[scenario.id].metrics[metric.id] }));
    const tooltipRows = scenarioValues.map(({ scenario, value }) => `<div class="scenario-tooltip-row"><span style='--scenario-color:${scenario.color}'>${scenario.label}</span><strong class="${value < 0 ? 'is-negative' : ''}">${formatMoney(value)}</strong></div>`).join('');
    const tooltipHtml = `<div class='scenario-tooltip-title'>${metric.label.join(' ')}</div>${tooltipRows}`.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    const accessibleLabel = `${metric.label.join(' ')} за горизонт. ${scenarioValues.map(({ scenario, value }) => `${scenario.label}: ${formatMoney(value)}`).join('. ')}`;
    let bars = '';
    scenarioValues.forEach(({ scenario, value }, scenarioIndex) => {
      const barX = xStart + scenarioIndex * (barWidth + barGap);
      const valueY = y(value);
      const top = Math.min(zeroY, valueY);
      const barHeight = Math.max(1, Math.abs(zeroY - valueY));
      bars += `<rect class="scenario-summary-bar" x="${barX}" y="${top}" width="${barWidth}" height="${barHeight}" rx="3" fill="${scenario.color}" />`;
    });
    const groupTitle = metric.label.length === 1
      ? svgText(center, height - 31, metric.label[0], 'scenario-summary-x-label')
      : `<text x="${center}" y="${height - 39}" class="scenario-summary-x-label" text-anchor="middle"><tspan x="${center}" dy="0">${metric.label[0]}</tspan><tspan x="${center}" dy="17">${metric.label[1]}</tspan></text>`;
    labels += `<g class="scenario-comparison-group" tabindex="0" role="img" aria-label="${accessibleLabel}" data-tooltip-html="${tooltipHtml}"><rect class="scenario-summary-hit-area" x="${center - groupStep / 2}" y="${pad.top}" width="${groupStep}" height="${plotHeight}" /><g aria-hidden="true">${bars}</g></g>${groupTitle}`;
  });

  target.innerHTML = `<svg class="data-chart scenario-summary-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Сравнение выручки, EBITDA, чистой прибыли и NPV за весь горизонт для трёх сценариев"><g>${grid}${labels}</g></svg>`;
  wireChartTooltips();
}

function renderScenarioMetricBars(target, metricId, caption, format, signed = false) {
  const values = SCENARIO_DEFINITIONS.map((scenario) => ({ scenario, value: scenarioResults[scenario.id].metrics[metricId] }));
  const max = Math.max(1, ...values.map(({ value }) => value === null ? 0 : Math.abs(value)));
  target.innerHTML = `<div class="scenario-bars">${values.map(({ scenario, value }) => {
    const ratio = value === null ? 0 : Math.abs(value) / max * (signed ? 50 : 100);
    const start = signed ? (value < 0 ? 50 - ratio : 50) : 0;
    const display = value === null ? 'Не окупается' : format(value);
    const label = `${scenario.label}: ${display}`;
    const sign = value < 0 ? 'is-negative' : '';
    return `<button type="button" class="scenario-bar ${sign}" data-value="${value ?? 0}" aria-label="${label}" style="--scenario-color:${scenario.color};--bar-width:${ratio}%;--bar-start:${start}%"><span class="scenario-bar-label">${scenario.label}</span><span class="scenario-bar-track${signed ? ' is-signed' : ''}"><i class="${sign}"></i></span><strong>${display}</strong></button>`;
  }).join('')}</div><p class="scenario-chart-note">${caption}</p>`;
  wireChartTooltips();
}

let scenarioResults = {};
function renderScenarioResults() {
  const sharedModelInputs = model?.input ?? sourceDefaults;
  scenarioResults = Object.fromEntries(SCENARIO_DEFINITIONS.map((scenario) => [scenario.id, calculateScenario(scenarioParameters[scenario.id], sharedModelInputs)]));
  const horizon = scenarioResults.base.model.periods.length;
  $('#scenario-horizon-label').textContent = `${horizon} ${monthWord(horizon)}`;
  document.querySelectorAll('.scenario-control-card > p').forEach((label) => {
    label.textContent = `Помесячный расчёт · ${horizon} ${monthWord(horizon)}`;
  });
  renderScenarioTable(scenarioResults);
  const periods = scenarioResults.base.model.periods;
  const series = (row) => SCENARIO_DEFINITIONS.map((scenario) => ({ name: scenario.label, color: scenario.color, values: scenarioResults[scenario.id].model.periods.map((period) => period.pnl[row]) }));
  document.querySelectorAll('.scenario-legend').forEach((legend) => {
    legend.innerHTML = SCENARIO_DEFINITIONS.map((scenario) => `<span><i class="legend-line" style="background:${scenario.color}"></i>${scenario.label}</span>`).join('');
  });
  $('#scenario-summary-legend').innerHTML = SCENARIO_DEFINITIONS.map((scenario) => `<span><i class="legend-box" style="background:${scenario.color}"></i>${scenario.label}</span>`).join('');
  renderScenarioSummaryChart($('#scenario-summary-chart'));
  renderScenarioLineChart($('#scenario-revenue-chart'), series(26), periods, 'Сравнение помесячной выручки по трём сценариям');
  renderScenarioLineChart($('#scenario-ebitda-chart'), series(41), periods, 'Сравнение помесячной EBITDA по трём сценариям');
  renderScenarioLineChart($('#scenario-profit-chart'), series(46), periods, 'Сравнение помесячной чистой прибыли по трём сценариям');
  renderScenarioLineChart($('#scenario-cash-chart'), SCENARIO_DEFINITIONS.map((scenario) => ({ name: scenario.label, color: scenario.color, values: scenarioResults[scenario.id].model.periods.map((period) => period.cash[65]) })), periods, 'Сравнение накопленного денежного потока по трём сценариям');
  renderScenarioMetricBars($('#scenario-npv-bars'), 'npv', 'NPV за расчётный период.', formatMoney, true);
  renderScenarioMetricBars($('#scenario-payback-bars'), 'paybackMonth', 'Месяц первого положительного накопленного потока.', (value) => `${value} мес.`);
  renderScenarioMetricBars($('#scenario-investment-bars'), 'investmentNeed', 'Максимальная потребность за расчётный период.', formatMoney);
  if (sensitivityAnalysis) renderAnalyticalNote();
}

function renderScenarios() {
  if (!scenarioControlsInitialized) {
    renderScenarioControls();
    scenarioControlsInitialized = true;
  }
  renderScenarioResults();
}

function tableValue(value, format) {
  if (format === 'percent') return formatPercent(value);
  if (value === null || !Number.isFinite(value)) return 'Ошибка: деление на ноль';
  if (format === 'decimal') return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function renderTable(target, rows, field) {
  const headers = model.periods.map((period) => `<th scope="col"><span>${period.label}</span></th>`).join('');
  const body = rows.map((row) => {
    const cells = model.periods.map((period) => {
      const value = period[field][row.row];
      const isExpense = row.kind === 'expense' || row.kind === 'outflow';
      const tone = row.format === 'percent' ? '' : isExpense && value > 0 ? 'is-negative' : signClass(value);
      return `<td class="${tone}">${tableValue(value, row.format)}</td>`;
    }).join('');
    const rowClass = row.kind === 'expense-total' ? 'row-total expense-total' : `row-${row.kind || 'normal'}`;
    return `<tr class="${rowClass}"><th scope="row">${row.label}</th>${cells}</tr>`;
  }).join('');
  target.innerHTML = `<table class="financial-table"><caption>Суммы, ₽; рентабельность, %</caption><thead><tr><th class="sticky-label" scope="col">Показатель</th>${headers}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderReports() {
  renderTable($('#pnl-table'), PNL_ROWS, 'pnl');
  renderTable($('#cash-table'), CASH_ROWS, 'cash');
  $('#report-range').textContent = `${model.periods[0].fullLabel} — ${model.periods.at(-1).fullLabel}`;
  $('#report-summary').innerHTML = `
    <div class="summary-cell"><span>NPV модели</span><strong class="${signClass(model.npv)}">${formatMoney(model.npv)}</strong></div>
    <div class="summary-cell"><span>IRR, годовая оценка Excel</span><strong>${model.irrAnnualized === null ? 'нет положительных значений в периоде' : formatPercent(model.irrAnnualized)}</strong></div>
    <div class="summary-cell"><span>Потребность в инвестициях</span><strong>${formatMoney(model.investmentNeed)}</strong></div>
    <div class="summary-cell"><span>Окупаемость по Excel</span><strong>${model.paybackMonth === null ? 'Не окупается' : `${model.paybackMonth} мес.`}</strong></div>`;
}

function updatePeriodOptions() {
  const select = $('#selected-period');
  const previousMonth = select.value || 'average';
  select.innerHTML = `<option value="average">Среднемесячно · весь горизонт</option>${model.periods.map((period, index) => `<option value="${index}">${period.fullLabel}</option>`).join('')}`;
  if (previousMonth === 'average') {
    select.value = 'average';
    return;
  }
  const matching = model.periods.findIndex((period) => period.month === previousMonth);
  selectedIndex = matching >= 0 ? matching : Math.min(selectedIndex, model.periods.length - 1);
  select.value = String(selectedIndex);
}

function render() {
  model = calculateModel(readInput());
  selectedIndex = Math.min(selectedIndex, model.periods.length - 1);
  const channelShare = FIXED.retailShare + FIXED.deliveryShare;
  const channelOk = Math.abs(channelShare - 1) < 0.01;
  $('#channel-check').innerHTML = `<span>Проверка микса каналов</span><strong class="${channelOk ? 'mix-ok' : 'mix-warning'}">${channelOk ? '✓' : '⚠'} ${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(channelShare * 100)}%</strong>`;
  updatePeriodOptions();
  renderKpis();
  renderCharts();
  renderExpenseStructure();
  renderReports();
  renderScenarios();
  renderSensitivity();
  $('#footer-period').textContent = `${model.periods.length} месяцев · ${model.periods[0].label} — ${model.periods.at(-1).label}`;
}

function sensitivityParameterValue(parameter, value) {
  if (parameter.format === 'money') return formatMoney(value);
  const formatted = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(parameter.format === 'percent' ? value * 100 : value);
  return `${formatted} ${parameter.unit}`;
}

function sensitivityPeriodLabel(period) {
  if (period === 'total') return `За весь горизонт · ${model.periods.length} ${monthWord(model.periods.length)}`;
  if (period === 'average') return `В среднем за месяц · ${model.periods.length} ${monthWord(model.periods.length)}`;
  const index = Number(period.split(':')[1]);
  return `За месяц · ${model.periods[index]?.fullLabel || 'не выбран'}`;
}

function prepareSensitivityControls() {
  const periodSelect = $('#sensitivity-period');
  const previousPeriod = periodSelect.value || 'average';
  const monthOptions = model.periods.map((period, index) => `<option value="month:${index}">За выбранный месяц · ${period.fullLabel}</option>`).join('');
  periodSelect.innerHTML = `<option value="average">В среднем за месяц</option><option value="total">За весь горизонт</option>${monthOptions}`;
  periodSelect.value = [...periodSelect.options].some((option) => option.value === previousPeriod) ? previousPeriod : 'average';

  const rowSelect = $('#sensitivity-row-parameter');
  const columnSelect = $('#sensitivity-column-parameter');
  const previousRow = rowSelect.value || 'traffic';
  const previousColumn = columnSelect.value || 'averageCheck';
  const options = SENSITIVITY_PARAMETERS.map(({ id, label }) => `<option value="${id}">${label}</option>`).join('');
  if (!rowSelect.options.length) rowSelect.innerHTML = options;
  if (!columnSelect.options.length) columnSelect.innerHTML = options;
  rowSelect.value = SENSITIVITY_PARAMETERS.some(({ id }) => id === previousRow) ? previousRow : 'traffic';
  columnSelect.value = SENSITIVITY_PARAMETERS.some(({ id }) => id === previousColumn) && previousColumn !== rowSelect.value
    ? previousColumn
    : SENSITIVITY_PARAMETERS.find(({ id }) => id !== rowSelect.value)?.id;
}

function renderSensitivityTornado(results, range) {
  const target = $('#sensitivity-tornado');
  const width = Math.max(760, target.clientWidth || 920);
  const height = 54 + results.length * 58;
  const left = 218;
  const right = 28;
  const top = 26;
  const plotWidth = width - left - right;
  const maxImpact = Math.max(0, ...results.flatMap(({ lowerDelta, upperDelta }) => [Math.abs(lowerDelta), Math.abs(upperDelta)]));
  const domain = maxImpact > 0 ? maxImpact * 1.12 : 1;
  const x = (value) => left + plotWidth / 2 + (value / domain) * (plotWidth / 2);
  const zeroX = x(0);
  let grid = '';
  for (let index = -2; index <= 2; index += 1) {
    const value = domain * index / 2;
    const xPosition = x(value);
    grid += `<line class="sensitivity-grid-line${index === 0 ? ' is-zero' : ''}" x1="${xPosition}" y1="${top - 8}" x2="${xPosition}" y2="${height - 12}" />`;
    grid += svgText(xPosition, 14, formatChartMoney(value), 'sensitivity-axis-label');
  }
  let rows = '';
  results.forEach((item, index) => {
    const y = top + index * 58;
    const label = `${item.label} · ${item.unit}`;
    rows += `<text x="8" y="${y + 17}" class="sensitivity-driver-label">${label}</text>`;
    const percentLabel = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0 }).format(range);
    rows += `<text x="${left - 8}" y="${y + 33}" class="sensitivity-bar-direction" text-anchor="end">−${percentLabel}</text><text x="${left - 8}" y="${y + 48}" class="sensitivity-bar-direction" text-anchor="end">+${percentLabel}</text>`;
    const zeroNote = item.isZeroBase ? ' Исходное значение равно нулю: процентный диапазон не меняет параметр.' : '';
    const variants = [
      { name: '− диапазон', value: item.lowerValue, profit: item.lowerProfit, delta: item.lowerDelta, y: y + 25, clamped: item.lowerWasClamped },
      { name: '+ диапазон', value: item.upperValue, profit: item.upperProfit, delta: item.upperDelta, y: y + 40, clamped: item.upperWasClamped },
    ];
    variants.forEach((variant) => {
      const endX = x(variant.delta);
      const rectX = Math.min(zeroX, endX);
      const barWidth = Math.max(2, Math.abs(endX - zeroX));
      const parameterDirection = variant.name.startsWith('−') ? 'Уменьшение' : 'Увеличение';
      const direction = `${parameterDirection} на ${percentLabel}`;
      const baseValue = sensitivityParameterValue(item, item.baseValue);
      const nextValue = sensitivityParameterValue(item, variant.value);
      const deltaTone = variant.delta < 0 ? 'is-negative' : (variant.delta > 0 ? 'is-positive' : 'is-neutral');
      const ariaLabel = `${item.label}. Исходное значение: ${baseValue}. Новое значение: ${nextValue}. ${direction}. Чистая прибыль: ${formatMoney(variant.profit)}. Изменение прибыли относительно базового значения: ${formatMoney(variant.delta)}.${zeroNote}${variant.clamped ? ' Значение ограничено допустимым диапазоном модели.' : ''}`;
      const note = [item.isZeroBase ? 'Исходное значение равно нулю, поэтому оно не меняется.' : '', variant.clamped ? 'Значение ограничено допустимым диапазоном модели.' : ''].filter(Boolean).join(' ');
      rows += `<rect class="sensitivity-bar sensitivity-hit sensitivity-tornado-hit ${variant.delta < 0 ? 'is-negative' : 'is-positive'}" data-value="${variant.delta}" data-parameter="${item.label}" data-base="${baseValue}" data-next="${nextValue}" data-direction="${direction}" data-profit="${formatMoney(variant.profit)}" data-delta="${formatMoney(variant.delta)}" data-delta-tone="${deltaTone}" data-note="${note}" x="${rectX}" y="${variant.y}" width="${barWidth}" height="9" rx="4.5" tabindex="0" aria-label="${ariaLabel}"></rect>`;
    });
    rows += `<line class="sensitivity-row-separator" x1="8" y1="${y + 53}" x2="${width - right}" y2="${y + 53}" />`;
  });
  target.innerHTML = `<svg class="sensitivity-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Торнадо-диаграмма изменения чистой прибыли относительно базового результата"><g>${grid}<line class="sensitivity-zero-line" x1="${zeroX}" y1="${top - 8}" x2="${zeroX}" y2="${height - 12}" />${rows}</g></svg>`;
}

function renderSensitivityMatrix(result) {
  const { rowParameter, columnParameter, levels, rows, baseProfit } = result;
  const headers = levels.map((fraction) => `<th scope="col">${new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' }).format(fraction)}<span>${sensitivityParameterValue(columnParameter, rows[2].cells[levels.indexOf(fraction)].columnValue)}</span></th>`).join('');
  const maxMagnitude = Math.max(1, ...rows.flatMap(({ cells }) => cells.map(({ profit }) => Math.abs(profit))));
  const body = rows.map((row) => {
    const rowCell = row.cells[0];
    const rowHeader = `<th scope="row">${new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' }).format(row.fraction)}<span>${sensitivityParameterValue(rowParameter, row.value)}</span></th>`;
    const cells = row.cells.map((cell) => {
      const tone = cell.isBase ? 'is-base' : (cell.profit < 0 ? 'is-loss' : (cell.profit > 0 ? 'is-profitable' : 'is-neutral'));
      const heat = Math.min(0.52, 0.12 + Math.abs(cell.profit) / maxMagnitude * 0.4);
      const rowZero = cell.rowIsZeroBase ? ' Исходное значение параметра строк равно нулю, поэтому процентное отклонение его не меняет.' : '';
      const columnZero = cell.columnIsZeroBase ? ' Исходное значение параметра столбцов равно нулю, поэтому процентное отклонение его не меняет.' : '';
      const clampNote = cell.rowWasClamped || cell.columnWasClamped ? ' Одно из значений ограничено допустимым диапазоном модели.' : '';
      const ariaLabel = `${rowParameter.label}: ${sensitivityParameterValue(rowParameter, cell.rowValue)}; ${columnParameter.label}: ${sensitivityParameterValue(columnParameter, cell.columnValue)}; чистая прибыль ${formatMoney(cell.profit)}; изменение к базе ${formatMoney(cell.delta)}.${rowZero}${columnZero}${clampNote}`;
      return `<td><button type="button" class="sensitivity-cell sensitivity-hit ${tone}" data-value="${cell.profit}" style="--heat-alpha:${heat}" aria-label="${ariaLabel}">${formatMoney(cell.profit)}</button></td>`;
    }).join('');
    return `<tr>${rowHeader}${cells}</tr>`;
  }).join('');
  $('#sensitivity-matrix').innerHTML = `<table class="sensitivity-table"><caption>Строки: ${rowParameter.label} · Столбцы: ${columnParameter.label}</caption><thead><tr><th scope="col">${rowParameter.label} ↓<span>Отклонение и значение</span></th>${headers}</tr></thead><tbody>${body}</tbody></table>`;
  return { ...result, maxCell: rows.flatMap(({ cells }) => cells).reduce((best, cell) => cell.profit > best.profit ? cell : best), minCell: rows.flatMap(({ cells }) => cells).reduce((worst, cell) => cell.profit < worst.profit ? cell : worst) };
}

function mixHexColors(start, end, fraction) {
  const parse = (hex) => [1, 3, 5].map((position) => Number.parseInt(hex.slice(position, position + 2), 16));
  const first = parse(start);
  const second = parse(end);
  const channel = first.map((value, index) => Math.round(value + (second[index] - value) * Math.max(0, Math.min(1, fraction))));
  return `#${channel.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function renderSensitivityHeatmap(result, bestCell) {
  const { rowParameter, columnParameter, levels, rows } = result;
  const cells = rows.flatMap(({ cells: rowCells }) => rowCells);
  const positiveValues = cells.filter(({ profit }) => profit > 0).map(({ profit }) => profit);
  const negativeValues = cells.filter(({ profit }) => profit < 0).map(({ profit }) => Math.abs(profit));
  const minPositive = positiveValues.length ? Math.min(...positiveValues) : 0;
  const maxPositive = positiveValues.length ? Math.max(...positiveValues) : 0;
  const maxNegative = negativeValues.length ? Math.max(...negativeValues) : 0;
  const colorFor = (profit) => {
    if (profit < 0) return mixHexColors('#70242d', '#d9575c', maxNegative ? Math.abs(profit) / maxNegative : 0);
    if (profit > 0) return mixHexColors('#12654e', '#c8a96b', maxPositive === minPositive ? 1 : (profit - minPositive) / (maxPositive - minPositive));
    return '#53665d';
  };
  const headers = levels.map((fraction, index) => {
    const value = rows[2].cells[index].columnValue;
    const delta = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' }).format(fraction);
    return `<th scope="col">${delta}<span>${sensitivityParameterValue(columnParameter, value)}</span></th>`;
  }).join('');
  const body = rows.map((row) => {
    const delta = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' }).format(row.fraction);
    const rowHeader = `<th scope="row">${delta}<span>${sensitivityParameterValue(rowParameter, row.value)}</span></th>`;
    const rowCells = row.cells.map((cell) => {
      const isBest = cell === bestCell;
      const rowZero = cell.rowIsZeroBase ? ' Исходное значение параметра строк равно нулю, поэтому процентное отклонение его не меняет.' : '';
      const columnZero = cell.columnIsZeroBase ? ' Исходное значение параметра столбцов равно нулю, поэтому процентное отклонение его не меняет.' : '';
      const clampNote = cell.rowWasClamped || cell.columnWasClamped ? ' Одно из значений ограничено допустимым диапазоном модели.' : '';
      const bestNote = isBest ? ' Максимальная чистая прибыль среди 25 рассчитанных сочетаний.' : '';
      const ariaLabel = `${rowParameter.label}: ${sensitivityParameterValue(rowParameter, cell.rowValue)}; ${columnParameter.label}: ${sensitivityParameterValue(columnParameter, cell.columnValue)}; чистая прибыль ${formatMoney(cell.profit)}; изменение к базе ${formatMoney(cell.delta)}.${rowZero}${columnZero}${clampNote}${bestNote}`;
      return `<td><button type="button" class="heatmap-cell sensitivity-hit${cell.isBase ? ' is-base' : ''}${isBest ? ' is-best' : ''}" style="--heat-color:${colorFor(cell.profit)}" data-value="${cell.profit}" aria-label="${ariaLabel}"><span>${formatMoney(cell.profit)}</span>${isBest ? '<i aria-hidden="true">★</i>' : ''}</button></td>`;
    }).join('');
    return `<tr>${rowHeader}${rowCells}</tr>`;
  }).join('');
  $('#sensitivity-heatmap-view').innerHTML = `<p class="heatmap-axis-caption">По горизонтали — ${columnParameter.label} · по вертикали — ${rowParameter.label}</p><table class="sensitivity-heatmap-table"><caption>Чистая прибыль при совместном изменении параметров</caption><thead><tr><th scope="col">${rowParameter.label} ↓<span>Отклонение и значение</span></th>${headers}</tr></thead><tbody>${body}</tbody></table><div class="heatmap-scale" aria-label="Шкала цветов чистой прибыли"><span class="is-loss">Убыток</span><i></i><span>Выше прибыль</span></div>`;
}

function setSensitivityMatrixView(view) {
  sensitivityMatrixView = view === 'heatmap' ? 'heatmap' : 'table';
  const tableActive = sensitivityMatrixView === 'table';
  $('#matrix-view-table').setAttribute('aria-pressed', String(tableActive));
  $('#matrix-view-heatmap').setAttribute('aria-pressed', String(!tableActive));
  $('#sensitivity-matrix-table-view').hidden = !tableActive;
  $('#sensitivity-heatmap-view').hidden = tableActive;
}

function renderSensitivity() {
  if (!$('#sensitivity-page')) return;
  prepareSensitivityControls();
  const settings = {
    range: Number($('#sensitivity-range').value),
    period: $('#sensitivity-period').value,
  };
  const currentInputs = { ...readInput(), rent: FIXED.rent };
  const tornado = calculateTornado(currentInputs, settings);
  renderSensitivityTornado(tornado.results, tornado.range);
  $('#sensitivity-baseline').textContent = formatMoney(tornado.baseProfit);
  $('#sensitivity-baseline').className = tornado.baseProfit < 0 ? 'is-negative' : 'is-positive';
  $('#sensitivity-period-label').textContent = sensitivityPeriodLabel(settings.period);

  const rowParameter = $('#sensitivity-row-parameter').value;
  const columnParameter = $('#sensitivity-column-parameter').value;
  const matrix = calculateWhatIf(currentInputs, { ...settings, rowParameter, columnParameter });
  const matrixExtremes = renderSensitivityMatrix(matrix);
  renderSensitivityHeatmap(matrix, matrixExtremes.maxCell);
  const bestDelta = matrixExtremes.maxCell.delta;
  const bestDeltaText = bestDelta > 0 ? `+${formatMoney(bestDelta)}` : formatMoney(bestDelta);
  $('#sensitivity-best-combination').innerHTML = `<span class="section-kicker">Наиболее выгодное сочетание в выбранном диапазоне</span><strong>${matrix.rowParameter.label}: ${sensitivityParameterValue(matrix.rowParameter, matrixExtremes.maxCell.rowValue)} · ${matrix.columnParameter.label}: ${sensitivityParameterValue(matrix.columnParameter, matrixExtremes.maxCell.columnValue)}</strong><div><b>${formatMoney(matrixExtremes.maxCell.profit)}</b><span> к базе: ${bestDeltaText}</span></div><small>Лучший результат среди 25 проанализированных сочетаний; он не гарантирует оптимальное решение для бизнеса.</small>`;
  setSensitivityMatrixView(sensitivityMatrixView);
  const strongest = tornado.results[0];
  const rangeLabel = `±${new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0 }).format(settings.range)}`;
  const strongestText = strongest.score === 0
    ? `В диапазоне ${rangeLabel} параметры не меняют чистую прибыль при выбранном периоде.`
    : `Самое сильное влияние в диапазоне ${rangeLabel}: ${strongest.label} · снижение параметра меняет прибыль на ${formatMoney(strongest.lowerDelta)}, повышение — на ${formatMoney(strongest.upperDelta)}.`;
  const bestTone = matrixExtremes.maxCell.profit < 0 ? 'is-negative' : 'is-positive';
  const worstTone = matrixExtremes.minCell.profit < 0 ? 'is-negative' : 'is-positive';
  $('#sensitivity-insights').innerHTML = `<article class="sensitivity-insight"><span>Наибольшее влияние</span><strong>${strongestText}</strong></article><article class="sensitivity-insight"><span>Лучшее сочетание в матрице</span><strong class="${bestTone}">${formatMoney(matrixExtremes.maxCell.profit)} чистой прибыли</strong></article><article class="sensitivity-insight"><span>Минимум в матрице</span><strong class="${worstTone}">${formatMoney(matrixExtremes.minCell.profit)} чистой прибыли</strong></article>`;
  sensitivityAnalysis = { settings, tornado, matrix, matrixExtremes };
  wireChartTooltips();
  renderAnalyticalNote();
}

function renderAnalyticalNote() {
  if (!model || !$('#analytical-note-page') || !sensitivityAnalysis) return;
  renderAnalyticalNotePage({
    model,
    scenarios: scenarioResults,
    tornado: sensitivityAnalysis.tornado,
    matrix: sensitivityAnalysis.matrix,
    helpers: { formatMoney, formatPercent, signClass, chartBase, formatChartMoney, wireChartTooltips, sensitivityPeriodLabel },
  });
}

function validateInputs() {
  const bounds = [
    ['horizon', 1, 24], ['traffic', 0, 1e9], ['conversion', 0, 100], ['basket', 0, 1e9],
    ['hours', 0, 24], ['days', 0, 31], ['cogs', 0, 100], ['marketing', 0, 1e12],
  ];
  for (const [id, min, max] of bounds) {
    const input = $(`#${id}`);
    const value = Number(input.value);
    const valid = input.value !== '' && Number.isFinite(value) && value >= min && value <= max;
    input.setAttribute('aria-invalid', String(!valid));
    if (!valid) return false;
  }
  const dateInput = $('#start-date');
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(dateInput.value);
  dateInput.setAttribute('aria-invalid', String(!validDate));
  return validDate;
}

function announce(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2500);
}

function persistScenarioSettings() {
  const saved = saveScenarioParameters(scenarioParameters, browserStorage());
  if (!saved && !storageWarningShown) {
    storageWarningShown = true;
    announce('Браузер не сохранил сценарии. Они останутся доступны до закрытия вкладки.');
  } else if (saved) storageWarningShown = false;
  return saved;
}

const syncFieldLabels = {
  startDate: 'Дата старта', horizon: 'Горизонт', traffic: 'Трафик', conversion: 'Конверсия',
  averageCheck: 'Средний чек', hoursPerDay: 'Часы работы в день', operatingDays: 'Рабочих дней в месяце',
  rawCogsShare: 'Доля себестоимости', marketing: 'Маркетинг', payroll: 'ФОТ',
};
let activeSourceLabel = 'Excel';

function formatSyncValue(key, value) {
  if (key === 'startDate') {
    const [year, month, day] = value.split('-');
    return `${day}.${month}.${year}`;
  }
  const formatted = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
  if (key === 'horizon') return `${formatted} мес.`;
  if (key === 'traffic') return `${formatted} чел./час`;
  if (key === 'conversion' || key === 'rawCogsShare') return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value * 100)}%`;
  if (key === 'averageCheck') return `${formatted} ₽`;
  if (key === 'hoursPerDay') return `${formatted} ч/день`;
  if (key === 'operatingDays') return `${formatted} дней`;
  if (key === 'payroll') return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)} ₽/мес.`;
  return `${formatted} ₽/мес.`;
}

function sameInputValue(first, second) {
  if (typeof first === 'number' && typeof second === 'number') return Math.abs(first - second) < 1e-9;
  return first === second;
}

function buildSyncChanges(inputs) {
  const current = readInput();
  const changes = [];
  for (const key of Object.keys(syncFieldLabels)) {
    if (!sameInputValue(current[key], inputs[key])) {
      changes.push({
        scope: 'Параметры модели',
        label: syncFieldLabels[key],
        before: formatSyncValue(key, current[key]),
        after: formatSyncValue(key, inputs[key]),
      });
    }
  }
  return changes;
}

function renderSyncConfirmation(inputs, changes) {
  const list = $('#google-sync-change-list');
  list.replaceChildren();
  for (const change of changes) {
    const item = document.createElement('li');
    const scope = document.createElement('span');
    const label = document.createElement('strong');
    const values = document.createElement('span');
    scope.textContent = change.scope;
    label.textContent = change.label;
    values.textContent = `${change.before} → ${change.after}`;
    item.append(scope, label, values);
    list.append(item);
  }
  if (changes.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'Значения источника и приложения совпадают. Пересчёт не требуется.';
    list.append(item);
  }
  const editedDashLabels = [...dashboardOverrides].filter((key) => !sameInputValue(readInput()[key], inputs[key])).map((key) => syncFieldLabels[key]);
  const notes = [];
  if (editedDashLabels.length) notes.push(`Вручную изменённые параметры Дашборда будут заменены после вашего подтверждения: ${editedDashLabels.join(', ')}.`);
  notes.push('Параметры всех сценариев останутся без изменений.');
  $('#google-sync-preserve-note').textContent = notes.join(' ');
  pendingGoogleInputs = inputs;
  $('#google-sync-dialog').showModal();
}

function setDashboardValues(inputs) {
  const values = {
    startDate: inputs.startDate,
    horizon: inputs.horizon,
    traffic: inputs.traffic,
    conversion: inputs.conversion * 100,
    averageCheck: inputs.averageCheck,
    hoursPerDay: inputs.hoursPerDay,
    operatingDays: inputs.operatingDays,
    rawCogsShare: inputs.rawCogsShare * 100,
    marketing: inputs.marketing,
  };
  for (const [key, selector] of Object.entries(inputIds)) $(selector).value = String(values[key]);
}

function applyGoogleInputs(inputs) {
  sourceDefaults = { ...inputs };
  activeSourceLabel = 'Google Таблицам';
  dashboardOverrides.clear();
  setDashboardValues(inputs);
  $('#reset-parameters').textContent = 'Сбросить к Google Таблицам';
  renderScenarioControls();
  selectedIndex = 0;
  $('#selected-period').value = 'average';
  render();
  $('#google-sync-status').textContent = `Источник Google Таблицы · проверено ${new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
  announce('Параметры Google Таблиц применены; финансовые показатели пересчитаны.');
}

async function checkGoogleInputs() {
  if (!validateInputs()) {
    announce('Сначала завершите ввод корректных параметров приложения.');
    return;
  }
  const button = $('#sync-google-sheets');
  const status = $('#google-sync-status');
  button.disabled = true;
  status.textContent = 'Загружаю параметры…';
  try {
    const inputs = await fetchGoogleSourceInputs();
    const changes = buildSyncChanges(inputs);
    status.textContent = changes.length ? 'Найдены изменения · ожидается подтверждение' : 'Данные уже актуальны';
    if (changes.length) renderSyncConfirmation(inputs, changes);
    else {
      activeSourceLabel = 'Google Таблицам';
      $('#reset-parameters').textContent = 'Сбросить к Google Таблицам';
      status.textContent = `Источник Google Таблицы · проверено ${new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
      announce('Источник проверен: параметры уже актуальны.');
    }
  } catch (error) {
    const details = error instanceof TypeError
      ? 'Не удалось прочитать Google Таблицу. Проверьте доступ к источнику и подключение к интернету.'
      : `Не удалось обновить данные: ${error.message || 'проверьте доступ и формат таблицы.'}`;
    status.textContent = 'Ошибка чтения Google Таблиц';
    announce(details);
  } finally {
    button.disabled = false;
  }
}

Object.entries(inputIds).forEach(([key, selector]) => {
  const input = $(selector);
  input.addEventListener('input', () => {
    if (!validateInputs()) return;
    dashboardOverrides.add(key);
    render();
  });
  input.addEventListener('change', () => {
    if (!validateInputs()) {
      announce('Проверьте значение: оно должно находиться в допустимом диапазоне.');
      return;
    }
    dashboardOverrides.add(key);
    render();
  });
});

$('#selected-period').addEventListener('change', (event) => {
  if (event.target.value !== 'average') selectedIndex = Number(event.target.value);
  renderKpis();
});

$('#reset-parameters').addEventListener('click', () => {
  setDashboardValues(sourceDefaults);
  dashboardOverrides.clear();
  selectedIndex = 0;
  render();
  announce(`Параметры восстановлены по источнику: ${activeSourceLabel}.`);
});

$('#scenario-controls').addEventListener('input', (event) => {
  const input = event.target.closest('input[data-scenario][data-driver]');
  if (!input || input.value === '') return;
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;
  const driver = SCENARIO_DRIVERS.find(({ id }) => id === input.dataset.driver);
  const adjusted = Math.max(driver.min, Math.min(driver.max ?? Number.POSITIVE_INFINITY, value));
  if (adjusted !== value) input.value = String(adjusted);
  scenarioParameters[input.dataset.scenario][input.dataset.driver] = adjusted;
  persistScenarioSettings();
  renderScenarioResults();
});

$('#scenario-controls').addEventListener('change', (event) => {
  const input = event.target.closest('input[data-scenario][data-driver]');
  if (!input) return;
  const driver = SCENARIO_DRIVERS.find(({ id }) => id === input.dataset.driver);
  const value = Number(input.value);
  const bounded = Math.max(driver.min, Math.min(driver.max ?? Number.POSITIVE_INFINITY, value));
  if (!Number.isFinite(value) || input.value === '') input.value = String(scenarioParameters[input.dataset.scenario][input.dataset.driver]);
  else if (bounded !== value) input.value = String(bounded);
  scenarioParameters[input.dataset.scenario][input.dataset.driver] = Number(input.value);
  persistScenarioSettings();
  renderScenarioResults();
});

$('#scenario-controls').addEventListener('click', (event) => {
  const copyButton = event.target.closest('[data-copy-main-scenario]');
  if (copyButton) {
    if (!window.confirm('Скопировать текущие параметры основной модели в базовый сценарий? Остальные сценарии и Дашборд не изменятся.')) return;
    const main = readInput();
    scenarioParameters.base = {
      traffic: main.traffic,
      conversionPercent: main.conversion * 100,
      averageCheck: main.averageCheck,
      rawCogsSharePercent: main.rawCogsShare * 100,
      payroll: main.payroll,
    };
    persistScenarioSettings();
    renderScenarioControls();
    renderScenarioResults();
    announce('Параметры основной модели скопированы в базовый сценарий.');
    return;
  }
  const resetButton = event.target.closest('[data-scenario-reset]');
  if (!resetButton) return;
  const scenarioId = resetButton.dataset.scenarioReset;
  scenarioParameters[scenarioId] = defaultScenarioParameters(scenarioId);
  persistScenarioSettings();
  renderScenarioControls();
  renderScenarioResults();
  announce(`Сценарий «${SCENARIO_DEFINITIONS.find(({ id }) => id === scenarioId).label}» сброшен к демонстрационным значениям.`);
});

$('#reset-all-scenarios').addEventListener('click', () => {
  if (!window.confirm('Вернуть демонстрационные значения для всех трёх сценариев? Текущие настройки будут заменены.')) return;
  scenarioParameters = defaultAllScenarioParameters();
  persistScenarioSettings();
  renderScenarioControls();
  renderScenarioResults();
  announce('Демонстрационные сценарии восстановлены.');
});

$('#sensitivity-period').addEventListener('change', renderSensitivity);
$('#sensitivity-range').addEventListener('change', renderSensitivity);
$('#sensitivity-row-parameter').addEventListener('change', () => {
  const row = $('#sensitivity-row-parameter');
  const column = $('#sensitivity-column-parameter');
  if (row.value === column.value) column.value = SENSITIVITY_PARAMETERS.find(({ id }) => id !== row.value)?.id;
  renderSensitivity();
});
$('#sensitivity-column-parameter').addEventListener('change', () => {
  const row = $('#sensitivity-row-parameter');
  const column = $('#sensitivity-column-parameter');
  if (row.value === column.value) row.value = SENSITIVITY_PARAMETERS.find(({ id }) => id !== column.value)?.id;
  renderSensitivity();
});
$('#matrix-view-table').addEventListener('click', () => setSensitivityMatrixView('table'));
$('#matrix-view-heatmap').addEventListener('click', () => setSensitivityMatrixView('heatmap'));
$('#expense-period').addEventListener('change', renderExpenseStructure);

$('#sync-google-sheets').addEventListener('click', checkGoogleInputs);
const googleSyncDialog = $('#google-sync-dialog');
const cancelGoogleSync = () => {
  pendingGoogleInputs = null;
  if (googleSyncDialog.open) googleSyncDialog.close();
  $('#google-sync-status').textContent = 'Обновление отменено · значения приложения сохранены';
};
$('#google-sync-cancel').addEventListener('click', cancelGoogleSync);
$('#google-sync-close').addEventListener('click', cancelGoogleSync);
googleSyncDialog.addEventListener('cancel', () => {
  pendingGoogleInputs = null;
  $('#google-sync-status').textContent = 'Обновление отменено · значения приложения сохранены';
});
$('#google-sync-apply').addEventListener('click', () => {
  const inputs = pendingGoogleInputs;
  pendingGoogleInputs = null;
  googleSyncDialog.close();
  if (inputs) applyGoogleInputs(inputs);
});

function navigateToPage(page) {
  const button = document.querySelector(`.nav-link[data-page="${page}"]`);
  document.querySelectorAll('.nav-link').forEach((nav) => nav.classList.toggle('is-active', nav === button));
  const mobileNavigation = $('#mobile-page-nav');
  if (mobileNavigation) mobileNavigation.value = page;
  document.querySelectorAll('.page-view').forEach((view) => view.classList.toggle('is-active', view.id === `${page}-page`));
  if (page === 'scenarios') renderScenarioResults();
  if (page === 'sensitivity') renderSensitivity();
  if (page === 'analytical-note') renderAnalyticalNote();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('.nav-link').forEach((button) => {
  button.addEventListener('click', () => navigateToPage(button.dataset.page));
});

$('#mobile-page-nav')?.addEventListener('change', (event) => navigateToPage(event.target.value));

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-note-nav]');
  if (!button) return;
  document.querySelector(`.nav-link[data-page="${button.dataset.noteNav}"]`)?.click();
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderCharts();
    if ($('#scenarios-page').classList.contains('is-active')) renderScenarioResults();
    if ($('#sensitivity-page').classList.contains('is-active')) renderSensitivity();
    if ($('#analytical-note-page').classList.contains('is-active')) renderAnalyticalNote();
  }, 120);
});

document.addEventListener('click', (event) => {
  const infoButton = event.target.closest('.info-button');
  if (infoButton) {
    event.stopPropagation();
    const opening = infoButton.dataset.pinned !== 'true';
    document.querySelectorAll('.info-button.is-open').forEach((other) => {
      other.classList.remove('is-open');
      other.setAttribute('aria-expanded', 'false');
      delete other.dataset.pinned;
    });
    infoButton.classList.toggle('is-open', opening);
    if (opening) infoButton.dataset.pinned = 'true';
    else delete infoButton.dataset.pinned;
    infoButton.setAttribute('aria-expanded', String(opening));
    if (opening) positionPopover(infoButton);
    return;
  }
  const hintButton = event.target.closest('.hint-button');
  if (hintButton) {
    announce(hintButton.dataset.hint);
    return;
  }
  if (!event.target.closest('.info-button')) {
    document.querySelectorAll('.info-button.is-open').forEach((button) => {
      button.classList.remove('is-open');
      button.setAttribute('aria-expanded', 'false');
      delete button.dataset.pinned;
    });
  }
});

function positionPopover(button) {
  const popover = button.querySelector('.popover');
  if (!popover) return;
  const rect = button.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
  const top = Math.min(rect.bottom + 8, window.innerHeight - 180);
  popover.style.position = 'fixed';
  popover.style.width = `${width}px`;
  popover.style.left = `${left}px`;
  popover.style.right = 'auto';
  popover.style.top = `${Math.max(12, top)}px`;
}

function wireInfoButtons() {
  document.querySelectorAll('.info-button').forEach((button) => {
    button.addEventListener('mouseenter', () => {
    document.querySelectorAll('.info-button.is-open').forEach((other) => {
      other.classList.remove('is-open'); other.setAttribute('aria-expanded', 'false');
    });
    button.classList.add('is-open');
    button.setAttribute('aria-expanded', 'true');
    positionPopover(button);
    });
    button.addEventListener('mouseleave', () => {
      if (button.matches(':focus') || button.classList.contains('is-open') && button.dataset.pinned === 'true') return;
      button.classList.remove('is-open'); button.setAttribute('aria-expanded', 'false');
    });
    button.addEventListener('focus', () => { button.classList.add('is-open'); positionPopover(button); });
    button.addEventListener('blur', () => { if (!button.dataset.pinned) { button.classList.remove('is-open'); button.setAttribute('aria-expanded', 'false'); } });
  });
}
window.addEventListener('resize', () => {
  const open = document.querySelector('.info-button.is-open');
  if (open) positionPopover(open);
});

render();

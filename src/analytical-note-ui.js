import { buildAnalyticalNote } from './analytical-note.js';

const $ = (selector) => document.querySelector(selector);

function signedMoney(value, formatMoney) {
  return value > 0 ? `+${formatMoney(value)}` : formatMoney(value);
}

function parameterValue(parameter, value, formatPercent) {
  if (parameter.format === 'money') return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)} ₽`;
  if (parameter.format === 'percent') return formatPercent(value);
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)} ${parameter.unit}`;
}

function infoButton(title, text) {
  return `<button class="info-button" type="button" aria-label="Пояснение: ${title}" aria-expanded="false"><span>i</span><span class="popover" role="tooltip">${text}</span></button>`;
}

function primaryCard({ title, value, detail, tone, hint }) {
  return `<article class="analytical-primary-card"><div class="analytical-kpi-title"><span>${title}</span>${infoButton(title, hint)}</div><strong class="analytical-kpi-value ${tone}">${value}</strong><p>${detail}</p></article>`;
}

function supplementaryCard(title, value, unit, hint, tone) {
  return `<article class="analytical-secondary-card"><div><span>${title}</span>${infoButton(title, hint)}</div><strong class="${tone}">${value}</strong><small>${unit}</small></article>`;
}

function renderCashFlowChart(periods, helpers) {
  const target = $('#analytical-cash-chart');
  const values = periods.map((period) => period.cash[65]);
  const width = Math.max(360, target.clientWidth || 800);
  const chart = helpers.chartBase(periods, [values], { width, formatAxis: helpers.formatChartMoney });
  const points = values.map((value, index) => {
    const label = `${periods[index].fullLabel}: накопленный денежный поток — ${helpers.formatMoney(value)}`;
    return `<circle class="series-point analytical-cash-point" data-value="${value}" cx="${chart.x(index)}" cy="${chart.y(value)}" r="4.2" fill="#a4e2c7" tabindex="0" aria-label="${label}" />`;
  }).join('');
  const polyline = values.map((value, index) => `${chart.x(index)},${chart.y(value)}`).join(' ');
  target.innerHTML = `<svg class="data-chart analytical-cash-svg" viewBox="0 0 ${chart.width} 286" role="img" aria-label="Помесячный график накопленного денежного потока за весь горизонт"><g>${chart.grid}${chart.zeroY}${chart.ticks}<polyline class="series-line analytical-cash-line" points="${polyline}" />${points}</g></svg>`;
  helpers.wireChartTooltips();
}

function renderFactors(note, helpers) {
  const { topFactors } = note.sensitivity;
  const range = note.sensitivity.range;
  const percentLabel = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0 }).format(range);
  const maxDelta = Math.max(1, ...topFactors.flatMap(({ lowerDelta, upperDelta }) => [Math.abs(lowerDelta), Math.abs(upperDelta)]));
  $('#analytical-factors-lead').textContent = `Пять параметров с наибольшим диапазоном влияния · ±${percentLabel} · ${helpers.sensitivityPeriodLabel(note.sensitivity.period).toLowerCase().replace(/[.]+$/, '')}. Расчётные варианты, не прогноз.`;
  $('#analytical-factor-chart').innerHTML = topFactors.map((item) => {
    const variants = [
      { sign: '−', value: item.lowerValue, delta: item.lowerDelta },
      { sign: '+', value: item.upperValue, delta: item.upperDelta },
    ];
    const bars = variants.map((variant) => {
      const width = variant.delta === 0 ? 0 : Math.max(2, Math.abs(variant.delta) / maxDelta * 100);
      const tone = variant.delta < 0 ? 'is-negative' : variant.delta > 0 ? 'is-positive' : 'is-neutral';
      return `<div class="analytical-factor-variant"><span>${variant.sign}${percentLabel} · ${parameterValue(item, variant.value, helpers.formatPercent)}</span><div class="analytical-factor-track"><i class="${tone}" style="--impact-width:${width}%"></i></div><b class="${tone}">${signedMoney(variant.delta, helpers.formatMoney)}</b></div>`;
    }).join('');
    return `<article class="analytical-factor-row"><h3>${item.label}</h3><p>${item.interpretation}</p>${bars}</article>`;
  }).join('');
  if (note.sensitivity.matrixBest && note.sensitivity.matrixWorst && note.sensitivity.matrix) {
    const { rowParameter, columnParameter } = note.sensitivity.matrix;
    $('#analytical-matrix-context').textContent = `Матрица What-if · ${rowParameter.label} и ${columnParameter.label}: чистая прибыль в 25 комбинациях — от ${helpers.formatMoney(note.sensitivity.matrixWorst.profit)} до ${helpers.formatMoney(note.sensitivity.matrixBest.profit)}.`;
  } else {
    $('#analytical-matrix-context').textContent = 'Матрица What-if недоступна.';
  }
}

function renderScenarioCards(note, helpers) {
  const scenarios = note.scenarios;
  if (note.scenariosSameInputs && note.scenariosSameResults) {
    $('#analytical-scenarios-lead').textContent = 'Параметры сценариев пока совпадают. Измените их на странице «Сценарии» для сравнения вариантов.';
  } else if (note.scenariosSameResults) {
    $('#analytical-scenarios-lead').textContent = 'Показатели сценариев сейчас совпадают, хотя исходные параметры различаются.';
  } else {
    $('#analytical-scenarios-lead').textContent = `Показаны реальные результаты страницы «Сценарии» за ${note.months} мес.; прибыль в карточках указана в среднем за месяц.`;
  }
  $('#analytical-scenario-cards').innerHTML = scenarios.map((scenario) => {
    const tone = scenario.monthlyNetProfit < 0 ? 'is-negative' : 'is-positive';
    const margin = scenario.netMargin === null ? '—' : helpers.formatPercent(scenario.netMargin);
    const payback = scenario.paybackMonth === null ? 'Не окупается в горизонте' : `${scenario.paybackMonth} мес.`;
    return `<article class="analytical-scenario-card scenario-${scenario.id}"><span class="analytical-scenario-name">${scenario.label}</span><strong class="analytical-scenario-profit ${tone}">${helpers.formatMoney(scenario.monthlyNetProfit)}<small>в среднем за месяц</small></strong><div><span>Чистая рентабельность</span><b>${margin}</b></div><div><span>Окупаемость по ДДС</span><b>${payback}</b></div></article>`;
  }).join('');
  const scenarioHeaders = scenarios.map(({ label }) => `<th scope="col">${label}</th>`).join('');
  const rows = [
    ['Выручка за горизонт', 'revenue', helpers.formatMoney],
    ['EBITDA за горизонт', 'ebitda', helpers.formatMoney],
    ['Чистая прибыль за горизонт', 'netProfit', helpers.formatMoney],
    ['Чистая рентабельность', 'netMargin', (value) => value === null ? '—' : helpers.formatPercent(value)],
    ['NPV', 'npv', helpers.formatMoney],
    ['Накопленный ДП на конец горизонта', 'cashFlow', helpers.formatMoney],
    ['Потребность в инвестициях', 'investmentNeed', helpers.formatMoney],
    ['Окупаемость', 'paybackMonth', (value) => value === null ? 'Не окупается' : `${value} мес.`],
  ].map(([label, key, formatter]) => `<tr><th scope="row">${label}</th>${scenarios.map((scenario) => {
    const value = scenario[key];
    return `<td class="${typeof value === 'number' && value < 0 ? 'is-negative' : ''}">${formatter(value)}</td>`;
  }).join('')}</tr>`).join('');
  $('#analytical-scenario-table').innerHTML = `<table class="analytical-comparison-table"><thead><tr><th scope="col">Показатель</th>${scenarioHeaders}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderActions(note, helpers) {
  const actions = note.actions.slice(0, 4);
  $('#analytical-actions').innerHTML = actions.map((item, index) => {
    const parameter = note.sensitivity.topFactors.find(({ id }) => id === item.id);
    const changeText = `${item.direction} на ${Math.round(item.range * 100)}% · ${parameterValue(parameter, item.baseValue, helpers.formatPercent)} → ${parameterValue(parameter, item.newValue, helpers.formatPercent)}`;
    const effectTone = item.delta < 0 ? 'is-negative' : item.delta > 0 ? 'is-positive' : 'is-neutral';
    const detail = `${item.action} Чувствительность рассчитана при изменении одного параметра; остальные предпосылки оставлены прежними. Это вариант модели, не обещание эффекта. Оценка усилий «${item.effort.toLowerCase()}» предварительная экспертная, а не расчёт модели.${item.clamped ? ' Значение ограничено допустимым диапазоном модели.' : ''}`;
    return `<article class="analytical-action-card"><div class="analytical-action-top"><span class="analytical-action-number">0${index + 1}</span><span class="analytical-effort">Усилия: ${item.effort.toLowerCase()}</span></div><h3>${item.title}</h3><p>${item.rationale}</p><div class="analytical-action-effect"><span>Расчётный вариант · ${changeText}</span><strong class="${effectTone}">${signedMoney(item.delta, helpers.formatMoney)} чистой прибыли</strong></div><details><summary>Подробности и ограничения</summary><p>${detail}</p></details></article>`;
  }).join('') || '<p class="analytical-empty-state">В текущем диапазоне нет параметров с ненулевым эффектом для расчётной рекомендации.</p>';
}

function renderRisks(note, helpers) {
  const risks = note.risks;
  $('#analytical-risk-list').innerHTML = risks.map((risk) => {
    const parameter = note.sensitivity.topFactors.find(({ id }) => id === risk.id)
      || note.sensitivity.allFactors.find(({ id }) => id === risk.id);
    const change = `${risk.direction === 'снижение' ? '−' : '+'}${Math.round(risk.range * 100)}% · ${parameterValue(parameter, risk.baseValue, helpers.formatPercent)} → ${parameterValue(parameter, risk.newValue, helpers.formatPercent)}${risk.clamped ? ' · значение ограничено моделью' : ''}`;
    return `<article class="analytical-risk-card"><div class="analytical-risk-heading"><h3>${risk.label}</h3><strong class="is-negative">${helpers.formatMoney(risk.delta)}</strong></div><p>${change}</p><small>${risk.control}</small></article>`;
  }).join('') || '<p class="analytical-empty-state">При выбранном диапазоне модель не рассчитала отрицательных изменений чистой прибыли.</p>';
}

export function renderAnalyticalNotePage({ model, scenarios, tornado, matrix, helpers }) {
  if (!model?.periods?.length || !tornado) return;
  const note = buildAnalyticalNote({ model, scenarios, tornado, matrix });
  const { primary } = note;
  const ratio = (value) => value === null ? '—' : helpers.formatPercent(value);
  const payback = primary.paybackMonth === null ? 'Не окупается' : `${primary.paybackMonth} мес.`;

  $('#analytical-primary-kpis').innerHTML = [
    primaryCard({ title: 'Среднемесячная выручка', value: helpers.formatMoney(primary.averageRevenue), detail: 'Точка безубыточности в текущей модели не рассчитывается.', tone: 'is-positive', hint: 'Среднее значение строки 26 ОПиУ за весь горизонт. Точка безубыточности не выводится: в интерфейсе модели такого рассчитанного показателя нет.' }),
    primaryCard({ title: 'Валовая маржа', value: ratio(primary.grossMargin), detail: 'Доля выручки после себестоимости · строки 32–33 ОПиУ.', tone: primary.grossMargin !== null && primary.grossMargin < 0 ? 'is-negative' : 'is-positive', hint: 'Рентабельность рассчитывается существующей моделью по строке 33 ОПиУ. Внешний норматив или целевой порог не применяется.' }),
    primaryCard({ title: 'Среднемесячная чистая прибыль', value: helpers.formatMoney(primary.averageNetProfit), detail: `Чистая рентабельность: ${ratio(primary.netMargin)}.`, tone: primary.averageNetProfit < 0 ? 'is-negative' : 'is-positive', hint: 'Среднее значение строки 46 ОПиУ за горизонт; рентабельность — отношение чистой прибыли к выручке.' }),
    primaryCard({ title: 'Срок окупаемости', value: payback, detail: `Потребность в инвестициях: ${helpers.formatMoney(primary.investmentNeed)}.`, tone: primary.paybackMonth === null ? 'is-negative' : 'is-positive', hint: 'Первый месяц, когда накопленный поток ДДС становится положительным по расчёту Excel. Это не гарантирует фактическую дату возврата отдельно внесённых инвестиций.' }),
  ].join('');
  $('#analytical-secondary-kpis').innerHTML = [
    supplementaryCard('Валовая прибыль', helpers.formatMoney(primary.grossProfitAverage), 'в среднем за месяц · ОПиУ', 'Валовая прибыль по строке 32 ОПиУ.', primary.grossProfitAverage < 0 ? 'is-negative' : ''),
    supplementaryCard('EBITDA', helpers.formatMoney(primary.ebitdaAverage), `в среднем за месяц · рентабельность ${ratio(primary.ebitdaMargin)}`, 'EBITDA по строке 41 ОПиУ; рентабельность — доля EBITDA в выручке.', primary.ebitdaAverage < 0 ? 'is-negative' : ''),
    supplementaryCard('NPV', helpers.formatMoney(primary.npv), `весь горизонт · ${note.months} мес.`, 'Показатель NPV из действующей модели. Положительное значение само по себе не подтверждает инвестиционную привлекательность.', primary.npv < 0 ? 'is-negative' : ''),
    supplementaryCard('Накопленный денежный поток', helpers.formatMoney(primary.cumulativeCashFlow), `на конец горизонта · ${note.months} мес.`, 'Строка 65 ДДС последнего месяца модели.', primary.cumulativeCashFlow < 0 ? 'is-negative' : ''),
  ].join('');

  renderScenarioCards(note, helpers);
  renderCashFlowChart(note.cashFlow.periods, helpers);
  const firstPositive = note.cashFlow.firstPositiveMonth;
  $('#analytical-cash-conclusion').textContent = firstPositive
    ? `Накопленный поток впервые становится положительным в ${firstPositive.fullLabel} (месяц ${firstPositive.index + 1}).`
    : 'Накопленный поток не становится положительным в пределах горизонта модели.';
  $('#analytical-payback-caveat').textContent = `CAPEX ${helpers.formatMoney(note.cashFlow.firstMonthCapex)} и операции первого месяца объединены в одном месячном итоге ДДС. Модель не определяет внутримесячный кассовый разрыв, поэтому формальный срок не гарантирует фактическую дату возврата инвестиций.`;

  renderFactors(note, helpers);
  renderActions(note, helpers);
  renderRisks(note, helpers);
  $('#analytical-conclusion').innerHTML = note.conclusions.map((sentence) => `<p>${sentence}</p>`).join('');
}

import { calculateExpenseStructure } from './expense-structure.js';

const FACTOR_MEANINGS = Object.freeze({
  traffic: 'При прочих равных показывает зависимость результата от числа посетителей.',
  conversion: 'Показывает зависимость результата от доли посетителей, совершающих покупку.',
  averageCheck: 'Показывает зависимость результата от среднего чека при прочих равных.',
  hoursPerDay: 'Показывает влияние количества часов работы в день.',
  operatingDays: 'Показывает влияние числа рабочих дней в месяце.',
  rawCogsShare: 'Показывает влияние доли себестоимости сырья в выручке.',
  marketing: 'Показывает влияние расходов на маркетинг; модель не связывает эти расходы с дополнительными продажами.',
  payroll: 'Показывает влияние фонда оплаты труда на чистую прибыль.',
  rent: 'Показывает влияние аренды при прочих равных.',
});

const FACTOR_ACTIONS = Object.freeze({
  traffic: { title: 'Проверить предпосылки трафика', action: 'Сверять прогноз посетителей с фактическим потоком по дням и часам.', effort: 'Высокие' },
  conversion: { title: 'Проверить конверсию', action: 'Сопоставлять число посетителей и покупок, выделяя периоды и точки с низкой конверсией.', effort: 'Средние' },
  averageCheck: { title: 'Оценить средний чек', action: 'Проверить состав корзины и фактический средний чек относительно входного значения модели.', effort: 'Средние' },
  hoursPerDay: { title: 'Сверить часы работы', action: 'Сопоставить график работы с распределением фактического потока посетителей.', effort: 'Средние' },
  operatingDays: { title: 'Сверить рабочие дни', action: 'Сравнить календарь работы с числом дней, заложенным в модели.', effort: 'Низкие' },
  rawCogsShare: { title: 'Контролировать долю себестоимости', action: 'Сверить закупочные цены, нормы расхода и списания с долей себестоимости в модели.', effort: 'Средние' },
  marketing: { title: 'Проверить расходы на маркетинг', action: 'Сопоставить бюджет с отдельными данными об обращениях и продажах: модель не рассчитывает прирост продаж от маркетинга.', effort: 'Средние' },
  payroll: { title: 'Оценить загрузку персонала', action: 'Сверить график персонала с фактической загрузкой и ФОТ, заложенным в модели.', effort: 'Средние' },
  rent: { title: 'Проверить арендную нагрузку', action: 'Сверить условия договора и арендный платёж с исходным значением модели.', effort: 'Высокие' },
});

const RISK_TITLES = Object.freeze({
  traffic: 'Снижение трафика', conversion: 'Снижение конверсии', averageCheck: 'Снижение среднего чека',
  hoursPerDay: 'Сокращение часов работы', operatingDays: 'Сокращение рабочих дней',
  rawCogsShare: 'Рост доли себестоимости', marketing: 'Рост расходов на маркетинг',
  payroll: 'Рост ФОТ', rent: 'Рост аренды',
});

const RISK_CONTROLS = Object.freeze({
  traffic: 'Сверять фактический поток посетителей с моделью по дням и часам.',
  conversion: 'Регулярно сопоставлять поток посетителей и число покупок.',
  averageCheck: 'Отслеживать средний чек по данным продаж и структуру корзины.',
  hoursPerDay: 'Сравнивать график работы и посещаемость по часам.',
  operatingDays: 'Сверять календарь работы и плановые рабочие дни.',
  rawCogsShare: 'Контролировать закупочные цены, нормы списания и себестоимость сырья.',
  marketing: 'Проверять бюджет и отдельно измерять фактические продажи по кампаниям.',
  payroll: 'Сверять график персонала, загрузку и фактический ФОТ.',
  rent: 'Проверять договорные условия и размер регулярного арендного платежа.',
});

function sumRow(model, row) {
  return model.periods.reduce((total, period) => total + (period.pnl[row] || 0), 0);
}

function sameNumbers(values) {
  return values.length < 2 || values.every((value) => value === values[0]);
}

function sameScenarioInputs(scenarios) {
  const items = Object.values(scenarios || {});
  if (items.length < 2) return false;
  const first = items[0].inputs;
  return items.slice(1).every(({ inputs }) => Object.keys(first).length === Object.keys(inputs).length
    && Object.keys(first).every((key) => inputs[key] === first[key]));
}

function sameScenarioResults(scenarios) {
  const items = Object.values(scenarios || {});
  if (items.length < 2) return false;
  const fields = ['revenue', 'grossProfit', 'ebitda', 'netProfit', 'npv', 'investmentNeed', 'paybackMonth'];
  const reference = items[0];
  return items.slice(1).every((item) => fields.every((key) => item.metrics[key] === reference.metrics[key])
    && item.model.periods.at(-1).cash[65] === reference.model.periods.at(-1).cash[65]);
}

function makeVariant(item, side) {
  const lower = side === 'lower';
  const fraction = lower ? -1 : 1;
  return {
    side,
    value: lower ? item.lowerValue : item.upperValue,
    profit: lower ? item.lowerProfit : item.upperProfit,
    delta: lower ? item.lowerDelta : item.upperDelta,
    fraction,
    clamped: lower ? item.lowerWasClamped : item.upperWasClamped,
  };
}

function preferredActionVariant(item) {
  const prefersIncrease = ['traffic', 'conversion', 'averageCheck', 'hoursPerDay', 'operatingDays'].includes(item.id);
  const preferred = makeVariant(item, prefersIncrease ? 'upper' : 'lower');
  const alternative = makeVariant(item, prefersIncrease ? 'lower' : 'upper');
  return preferred.delta > 0 || alternative.delta <= preferred.delta ? preferred : alternative;
}

function deteriorationVariant(item) {
  const variants = [makeVariant(item, 'lower'), makeVariant(item, 'upper')];
  return variants.reduce((worst, current) => current.delta < worst.delta ? current : worst);
}

export function buildAnalyticalNote({ model, scenarios, tornado, matrix }) {
  if (!model?.periods?.length) throw new Error('Нет рассчитанных периодов для аналитической записки.');
  const months = model.periods.length;
  const revenue = sumRow(model, 26);
  const grossProfit = sumRow(model, 32);
  const ebitda = sumRow(model, 41);
  const netProfit = sumRow(model, 46);
  const grossMargin = revenue === 0 ? null : grossProfit / revenue;
  const netMargin = revenue === 0 ? null : netProfit / revenue;
  const ebitdaMargin = revenue === 0 ? null : ebitda / revenue;
  const expenseStructure = calculateExpenseStructure(model, 'total');
  const topExpenses = expenseStructure.categories
    .filter((category) => category.amount > 0)
    .sort((first, second) => second.amount - first.amount)
    .slice(0, 3);
  const worstCashPeriod = model.periods.reduce((worst, current) => current.cash[65] < worst.cash[65] ? current : worst, model.periods[0]);
  const sensitivityResults = tornado?.results || [];
  const topFactors = sensitivityResults.slice(0, 5).map((item) => ({
    ...item,
    interpretation: FACTOR_MEANINGS[item.id] || 'Показывает влияние изменения параметра на чистую прибыль при прочих равных.',
  }));
  const scenarioOrder = ['pessimistic', 'base', 'optimistic'];
  const scenarioNames = { pessimistic: 'Пессимистический', base: 'Базовый', optimistic: 'Оптимистический' };
  const scenarioRows = scenarioOrder.filter((id) => scenarios?.[id]).map((id) => {
    const scenario = scenarios[id];
    const horizon = scenario.model.periods.length;
    return {
      id,
      label: scenarioNames[id],
      inputs: scenario.inputs,
      revenue: scenario.metrics.revenue,
      ebitda: scenario.metrics.ebitda,
      netProfit: scenario.metrics.netProfit,
      monthlyNetProfit: scenario.metrics.netProfit / horizon,
      netMargin: scenario.metrics.netMargin,
      npv: scenario.metrics.npv,
      cashFlow: scenario.model.periods.at(-1).cash[65],
      investmentNeed: scenario.metrics.investmentNeed,
      paybackMonth: scenario.metrics.paybackMonth,
    };
  });
  const scenarioInputsSame = sameScenarioInputs(scenarios);
  const scenarioResultsSame = sameScenarioResults(scenarios);
  const scenarioProfitValues = scenarioRows.map(({ netProfit: value }) => value);
  const scenarioProfitSpread = scenarioProfitValues.length
    ? Math.max(...scenarioProfitValues) - Math.min(...scenarioProfitValues)
    : null;
  const actions = topFactors.filter((item) => item.score > 0).map((item) => {
    const action = FACTOR_ACTIONS[item.id] || { title: `Проверить параметр «${item.label}»`, action: 'Сверить исходное значение параметра с фактическими данными.', effort: 'Средние' };
    const variant = preferredActionVariant(item);
    return {
      id: item.id,
      label: item.label,
      score: item.score,
      title: action.title,
      action: action.action,
      effort: action.effort,
      baseValue: item.baseValue,
      newValue: variant.value,
      delta: variant.delta,
      direction: variant.side === 'lower' ? 'уменьшение' : 'увеличение',
      range: tornado?.range ?? 0.2,
      clamped: variant.clamped,
      rationale: `Изменение параметра «${item.label}» входит в пятёрку крупнейших диапазонов влияния на чистую прибыль.`,
    };
  }).sort((first, second) => second.score - first.score).slice(0, 4);
  const risks = sensitivityResults.map((item) => ({ item, variant: deteriorationVariant(item) }))
    .filter(({ variant }) => variant.delta < 0)
    .sort((first, second) => first.variant.delta - second.variant.delta)
    .slice(0, 5)
    .map(({ item, variant }) => ({
      id: item.id,
      label: RISK_TITLES[item.id] || item.label,
      parameter: item.label,
      baseValue: item.baseValue,
      newValue: variant.value,
      delta: variant.delta,
      direction: variant.side === 'lower' ? 'снижение' : 'увеличение',
      range: tornado?.range ?? 0.2,
      clamped: variant.clamped,
      control: RISK_CONTROLS[item.id] || 'Сверять фактическое значение с исходным параметром модели.',
    }));
  const matrixCells = (matrix?.rows || []).flatMap((row) => row.cells);
  const matrixBest = matrixCells.length ? matrixCells.reduce((best, cell) => cell.profit > best.profit ? cell : best) : null;
  const matrixWorst = matrixCells.length ? matrixCells.reduce((worst, cell) => cell.profit < worst.profit ? cell : worst) : null;
  const matrixBaseProfit = tornado?.baseProfit ?? netProfit / months;
  const firstPositivePeriod = model.periods.find((item) => item.cash[65] > 0) || null;
  const conclusions = [
    netProfit > 0 ? 'По ОПиУ проект прибыльный в среднем за месяц.' : netProfit < 0 ? 'По ОПиУ проект убыточный в среднем за месяц.' : 'По ОПиУ чистая прибыль в среднем за месяц равна нулю.',
    firstPositivePeriod ? `Накопленный поток впервые становится положительным в ${firstPositivePeriod.fullLabel.replace(/[.]$/, '')}.` : 'Накопленный поток не становится положительным в пределах горизонта.',
    risks[0] ? `Наибольшее расчётное снижение среди проверенных вариантов связано с риском «${risks[0].label}».` : 'В текущем диапазоне нет рассчитанных вариантов со снижением прибыли.',
    topFactors[0] ? `Наиболее значимый фактор чувствительности — ${topFactors[0].label}.` : 'Расчётные факторы чувствительности недоступны.',
    actions[0] ? `Приоритетное действие для оценки: ${actions[0].title.toLowerCase()}.` : 'Для действий следует сначала уточнить исходные предпосылки модели.',
  ];

  return {
    months,
    primary: {
      averageRevenue: revenue / months,
      grossMargin,
      averageNetProfit: netProfit / months,
      netMargin,
      paybackMonth: model.paybackMonth,
      investmentNeed: model.investmentNeed,
      grossProfitAverage: grossProfit / months,
      ebitdaAverage: ebitda / months,
      ebitdaMargin,
      npv: model.npv,
      cumulativeCashFlow: model.periods.at(-1).cash[65],
      breakEvenAvailable: false,
    },
    topExpenses,
    cashFlow: {
      periods: model.periods,
      firstPositiveMonth: firstPositivePeriod,
      endCash: model.periods.at(-1).cash[65],
      maxFundingNeed: model.investmentNeed,
      worstCash: worstCashPeriod.cash[65],
      worstCashMonth: worstCashPeriod.fullLabel,
      hasNegativeMonth: model.periods.some((period) => period.cash[65] < 0),
      firstMonthCapex: model.periods[0].cash[54],
    },
    scenarios: scenarioRows,
    scenariosSameInputs: scenarioInputsSame,
    scenariosSameResults: scenarioResultsSame,
    scenarioProfitSpread,
    sensitivity: {
      period: tornado?.period || 'average',
      range: tornado?.range ?? 0.2,
      baseProfit: matrixBaseProfit,
      matrix,
      matrixBest,
      matrixWorst,
      allFactors: sensitivityResults,
      topFactors,
      risks,
    },
    actions,
    risks,
    conclusions,
  };
}

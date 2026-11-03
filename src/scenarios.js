import { calculateModel, EXCEL_DEFAULTS, FIXED } from './model.js';

export const SCENARIO_DEFINITIONS = Object.freeze([
  { id: 'optimistic', label: 'Оптимистический', color: '#d9bd82' },
  { id: 'base', label: 'Базовый', color: '#61c6a2' },
  { id: 'pessimistic', label: 'Пессимистический', color: '#b7c0bc' },
]);

export const SCENARIO_DRIVERS = Object.freeze([
  { id: 'traffic', label: 'Трафик', unit: 'чел./час', value: 500, min: 0, step: 1 },
  { id: 'conversionPercent', label: 'Конверсия в покупку', unit: '%', value: 25, min: 0, max: 100, step: 0.1 },
  { id: 'averageCheck', label: 'Средний чек', unit: '₽', value: 250, min: 0, step: 1 },
  { id: 'rawCogsSharePercent', label: 'Доля себестоимости в выручке', unit: '%', value: 35, min: 0, max: 100, step: 0.1 },
  { id: 'payroll', label: 'ФОТ', unit: '₽/мес.', value: FIXED.payroll, min: 0, step: 1000 },
]);

export const EXCEL_SCENARIO_DEFAULTS = Object.freeze(Object.fromEntries(
  SCENARIO_DRIVERS.map(({ id, value }) => [id, value]),
));

export const DEMONSTRATION_SCENARIO_DEFAULTS = Object.freeze({
  optimistic: Object.freeze({ ...EXCEL_SCENARIO_DEFAULTS, traffic: 900, averageCheck: 475 }),
  base: Object.freeze({ ...EXCEL_SCENARIO_DEFAULTS }),
  pessimistic: Object.freeze({ ...EXCEL_SCENARIO_DEFAULTS, traffic: 250, averageCheck: 150 }),
});

export function defaultScenarioParameters(scenarioId = 'base') {
  const defaults = DEMONSTRATION_SCENARIO_DEFAULTS[scenarioId];
  if (!defaults) throw new Error(`Неизвестный сценарий «${scenarioId}».`);
  return { ...defaults };
}

export function defaultAllScenarioParameters() {
  return Object.fromEntries(Object.keys(DEMONSTRATION_SCENARIO_DEFAULTS).map((id) => [id, defaultScenarioParameters(id)]));
}

function finiteValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function calculateScenario(parameters = {}, base = EXCEL_DEFAULTS) {
  const values = Object.fromEntries(SCENARIO_DRIVERS.map(({ id }) => [
    id,
    finiteValue(parameters[id], EXCEL_SCENARIO_DEFAULTS[id]),
  ]));
  const model = calculateModel({
    ...base,
    traffic: values.traffic,
    conversion: values.conversionPercent / 100,
    averageCheck: values.averageCheck,
    rawCogsShare: values.rawCogsSharePercent / 100,
    payroll: values.payroll,
  });
  const total = (row) => model.periods.reduce((sum, period) => sum + period.pnl[row], 0);
  const revenue = total(26);
  return {
    inputs: values,
    model,
    metrics: {
      revenue,
      grossProfit: total(32),
      ebitda: total(41),
      netProfit: total(46),
      netMargin: revenue === 0 ? null : total(46) / revenue,
      npv: model.npv,
      investmentNeed: model.investmentNeed,
      paybackMonth: model.paybackMonth,
    },
  };
}

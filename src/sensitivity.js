import { calculateModel, FIXED } from './model.js';

export const SENSITIVITY_PARAMETERS = Object.freeze([
  { id: 'traffic', label: 'Трафик', key: 'traffic', unit: 'чел./час', min: 0, max: 1e9, format: 'number' },
  { id: 'conversion', label: 'Конверсия в покупку', key: 'conversion', unit: '%', min: 0, max: 1, format: 'percent' },
  { id: 'averageCheck', label: 'Средний чек', key: 'averageCheck', unit: '₽', min: 0, max: 1e9, format: 'money' },
  { id: 'hoursPerDay', label: 'Часы работы в день', key: 'hoursPerDay', unit: 'ч/день', min: 0, max: 24, format: 'number' },
  { id: 'operatingDays', label: 'Рабочих дней в месяце', key: 'operatingDays', unit: 'дней', min: 0, max: 31, format: 'number' },
  { id: 'rawCogsShare', label: 'Доля себестоимости сырья', key: 'rawCogsShare', unit: '%', min: 0, max: 1, format: 'percent' },
  { id: 'marketing', label: 'Маркетинг', key: 'marketing', unit: '₽/мес.', min: 0, max: 1e12, format: 'money' },
  { id: 'payroll', label: 'ФОТ', key: 'payroll', unit: '₽/мес.', min: 0, max: 1e12, format: 'money' },
  { id: 'rent', label: 'Аренда', key: 'rent', unit: '₽/мес.', min: 0, max: 1e12, format: 'money' },
]);

export const SENSITIVITY_RANGES = Object.freeze([0.1, 0.2, 0.3]);

function parameterById(id) {
  const parameter = SENSITIVITY_PARAMETERS.find((item) => item.id === id);
  if (!parameter) throw new Error(`Неизвестный параметр анализа: ${id}.`);
  return parameter;
}

function normalizeRange(range) {
  const normalized = Number(range);
  if (!SENSITIVITY_RANGES.includes(normalized)) throw new Error('Диапазон должен быть ±10%, ±20% или ±30%.');
  return normalized;
}

export function varyParameter(inputs, parameterId, fraction) {
  const parameter = parameterById(parameterId);
  const range = Number(fraction);
  if (!Number.isFinite(range) || range < -1 || range > 1) throw new Error('Отклонение параметра должно быть числом от −100% до +100%.');
  const currentValue = Number(inputs[parameter.key] ?? (parameter.key === 'rent' ? FIXED.rent : NaN));
  if (!Number.isFinite(currentValue)) throw new Error(`Для параметра «${parameter.label}» нет корректного исходного значения.`);
  const proposedValue = currentValue * (1 + range);
  const value = Math.max(parameter.min, Math.min(parameter.max, proposedValue));
  return { inputs: { ...inputs, [parameter.key]: value }, currentValue, value, isZeroBase: currentValue === 0, wasClamped: value !== proposedValue };
}

export function netProfitForPeriod(model, period = 'average') {
  const profits = model.periods.map((item) => item.pnl[46]);
  if (!profits.length || profits.some((value) => !Number.isFinite(value))) {
    throw new Error('Не удалось получить чистую прибыль по строке 46 ОПиУ.');
  }
  if (period === 'total') return profits.reduce((total, value) => total + value, 0);
  if (period === 'average') return profits.reduce((total, value) => total + value, 0) / profits.length;
  const match = /^month:(\d+)$/.exec(period);
  if (match) {
    const index = Number(match[1]);
    if (index < 0 || index >= profits.length) throw new Error('Выбранный месяц отсутствует в горизонте модели.');
    return profits[index];
  }
  throw new Error('Выберите месяц, среднее значение или весь горизонт.');
}

function calculate(inputs, period) {
  return netProfitForPeriod(calculateModel(inputs), period);
}

export function calculateTornado(inputs, { range = 0.2, period = 'average' } = {}) {
  const normalizedRange = normalizeRange(range);
  const baseProfit = calculate(inputs, period);
  const results = SENSITIVITY_PARAMETERS.map((parameter, order) => {
    const lower = varyParameter(inputs, parameter.id, -normalizedRange);
    const upper = varyParameter(inputs, parameter.id, normalizedRange);
    const lowerProfit = calculate(lower.inputs, period);
    const upperProfit = calculate(upper.inputs, period);
    return {
      ...parameter,
      order,
      baseValue: lower.currentValue,
      lowerValue: lower.value,
      upperValue: upper.value,
      lowerWasClamped: lower.wasClamped,
      upperWasClamped: upper.wasClamped,
      lowerProfit,
      upperProfit,
      lowerDelta: lowerProfit - baseProfit,
      upperDelta: upperProfit - baseProfit,
      score: Math.abs(upperProfit - lowerProfit),
      isZeroBase: lower.isZeroBase,
    };
  });
  results.sort((first, second) => {
    const difference = second.score - first.score;
    return Math.abs(difference) < 0.01 ? first.order - second.order : difference;
  });
  return { baseProfit, range: normalizedRange, period, results };
}

export function calculateWhatIf(inputs, { rowParameter, columnParameter, range = 0.2, period = 'average' } = {}) {
  if (!rowParameter || !columnParameter || rowParameter === columnParameter) {
    throw new Error('Для матрицы выберите два разных параметра.');
  }
  const rowDefinition = parameterById(rowParameter);
  const columnDefinition = parameterById(columnParameter);
  const normalizedRange = normalizeRange(range);
  const baseProfit = calculate(inputs, period);
  const levels = [-normalizedRange, -normalizedRange / 2, 0, normalizedRange / 2, normalizedRange];
  const rows = levels.map((rowFraction) => {
    const rowValue = varyParameter(inputs, rowParameter, rowFraction);
    const cells = levels.map((columnFraction) => {
      const columnValue = varyParameter(inputs, columnParameter, columnFraction);
      const candidate = { ...rowValue.inputs, [columnDefinition.key]: columnValue.value };
      const profit = calculate(candidate, period);
      return {
        rowFraction,
        columnFraction,
        rowValue: rowValue.value,
        columnValue: columnValue.value,
        rowWasClamped: rowValue.wasClamped,
        columnWasClamped: columnValue.wasClamped,
        profit,
        delta: profit - baseProfit,
        isBase: rowFraction === 0 && columnFraction === 0,
        rowIsZeroBase: rowValue.isZeroBase,
        columnIsZeroBase: columnValue.isZeroBase,
      };
    });
    return { fraction: rowFraction, value: rowValue.value, isZeroBase: rowValue.isZeroBase, cells };
  });
  return {
    baseProfit,
    range: normalizedRange,
    period,
    rowParameter: rowDefinition,
    columnParameter: columnDefinition,
    levels,
    rows,
  };
}

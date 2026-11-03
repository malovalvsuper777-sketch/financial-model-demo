// Формулы и фиксированные значения перенесены из листов Excel
// «Параметры» и «Финмодель». Существующие расхождения намеренно сохранены.
export const EXCEL_DEFAULTS = Object.freeze({
  startDate: '2025-09-04',
  horizon: 24,
  traffic: 500,
  conversion: 0.25,
  averageCheck: 250,
  hoursPerDay: 12,
  operatingDays: 26,
  rawCogsShare: 0.35,
  marketing: 0.5,
});

export const FIXED = Object.freeze({
  retailShare: 0.8, // Параметры!F5
  deliveryShare: 0.2, // Параметры!F6
  aggregatorFee: 0.2, // Параметры!F7
  packagingShare: 0.03, // Финмодель!строка 28, задано в формуле
  sanitationShare: 0.02, // Финмодель!строка 29, задано в формуле
  logisticsShare: 0.05, // Финмодель!строка 30, задано в формуле
  payroll: 290000, // SUMIF по Параметры!B:B содержит «ФОТ»
  rent: 102000, // Параметры!F22
  utilities: 12000, // Параметры!F23
  admin: 10000, // Параметры!F29
  capex: 1061500, // SUMIF «Стоимость оборудования»
  usefulLifeMonths: 84, // Параметры!F38
  usnRate: 0.06, // Параметры!F43
  annualDiscountRate: 0.3, // Параметры!F44
  payableDays: 20, // Параметры!F41
  payrollMultiplier: 1.34, // Финмодель!строка 56
});

export const PNL_ROWS = [
  { row: 26, label: 'Выручка', explanation: 'Трафик × часы × дни × конверсия × средний чек', kind: 'total' },
  { row: 27, label: 'Себестоимость сырья', explanation: 'Выручка × доля себестоимости', kind: 'expense' },
  { row: 28, label: 'Себестоимость упаковки', explanation: '3% от выручки', kind: 'expense' },
  { row: 29, label: 'Санитария', explanation: '2% от выручки', kind: 'expense' },
  { row: 30, label: 'Логистика сырья', explanation: '5% от выручки', kind: 'expense' },
  { row: 31, label: 'Себестоимость итого', explanation: 'Сумма строк 27–30', kind: 'expense-total' },
  { row: 32, label: 'Валовая прибыль', explanation: 'Выручка − себестоимость', kind: 'key' },
  { row: 33, label: 'Валовая рентабельность', explanation: 'Валовая прибыль / выручка', format: 'percent', kind: 'ratio' },
  { row: 34, label: 'Комиссии агрегаторов', explanation: 'Выручка доставки × комиссия', kind: 'expense' },
  { row: 35, label: 'ФОТ', explanation: 'Зарплатный фонд', kind: 'expense' },
  { row: 36, label: 'Аренда', explanation: 'Аренда помещения', kind: 'expense' },
  { row: 37, label: 'Коммунальные', explanation: 'Коммунальные услуги', kind: 'expense' },
  { row: 38, label: 'Маркетинг', explanation: 'Маркетинговые расходы', format: 'decimal', kind: 'expense' },
  { row: 39, label: 'Прочие расходы', explanation: 'Административные расходы', kind: 'expense' },
  { row: 40, label: 'OPEX итого', explanation: 'Сумма операционных расходов', kind: 'expense-total' },
  { row: 41, label: 'EBITDA', explanation: 'Валовая прибыль − комиссии − OPEX', kind: 'key' },
  { row: 42, label: 'Амортизация', explanation: 'Стоимость оборудования / срок полезного использования', kind: 'expense' },
  { row: 43, label: 'EBIT', explanation: 'EBITDA − амортизация', kind: 'total' },
  { row: 44, label: 'Финансовые расходы', explanation: 'Вводной параметр, в Excel равен нулю', kind: 'expense' },
  { row: 45, label: 'Налоги УСН', explanation: 'Максимум из нуля и выручки × ставка УСН', kind: 'expense' },
  { row: 46, label: 'Чистая прибыль', explanation: 'EBIT − финансовые расходы − налоги', kind: 'key' },
  { row: 47, label: 'Чистая рентабельность', explanation: 'Чистая прибыль / выручка', format: 'percent', kind: 'ratio' },
];

export const CASH_ROWS = [
  { row: 52, label: 'Остаток на начало', explanation: 'Остаток денежных средств на начало месяца' },
  { row: 53, label: 'Поступления от продаж', explanation: 'Выручка минус комиссии агрегаторов' },
  { row: 54, label: 'Инвестиции', explanation: 'Стоимость оборудования', kind: 'total' },
  { row: 55, label: 'Выплаты поставщикам', explanation: 'Себестоимость сырья × (1 − DPO / 30)', kind: 'outflow' },
  { row: 56, label: 'Выплаты ФОТ', explanation: 'ФОТ × 1,34', kind: 'outflow' },
  { row: 57, label: 'Аренда и коммунальные', explanation: 'Фиксированные расходы', kind: 'outflow' },
  { row: 58, label: 'Маркетинг', explanation: 'Маркетинговые расходы', format: 'decimal', kind: 'outflow' },
  { row: 59, label: 'Прочие расходы', explanation: 'Административные расходы', kind: 'outflow' },
  { row: 60, label: 'Налоги', explanation: 'УСН из ОПиУ', kind: 'outflow' },
  { row: 61, label: 'Итого приток', explanation: 'Сумма поступлений' , kind: 'total' },
  { row: 62, label: 'Итого отток', explanation: 'Сумма выплат' , kind: 'expense-total' },
  { row: 63, label: 'Чистый ДП', explanation: 'Приток − отток', kind: 'key' },
  { row: 64, label: 'Остаток на конец', explanation: 'Остаток на начало + чистый денежный поток', kind: 'total' },
  { row: 65, label: 'Накопленный поток', explanation: 'Сумма чистого денежного потока с начала проекта', kind: 'key' },
];

function monthDate(isoDate, offset) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + offset, 1));
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

export function formatMonth(date, style = 'short') {
  return new Intl.DateTimeFormat('ru-RU', style === 'short'
    ? { month: 'short', year: '2-digit', timeZone: 'UTC' }
    : { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function annualizedIRR(values) {
  // Excel IRR возвращает ошибку, если в потоках отсутствуют значения обоих знаков.
  if (!values.some((value) => value < 0) || !values.some((value) => value > 0)) return null;
  const npv = (rate) => values.reduce((total, value, index) => total + value / ((1 + rate) ** index), 0);
  let rate = 0.1;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const value = npv(rate);
    const derivative = values.reduce((total, cash, index) => index === 0 ? total : total - index * cash / ((1 + rate) ** (index + 1)), 0);
    if (!Number.isFinite(value) || !Number.isFinite(derivative) || Math.abs(derivative) < 1e-12) break;
    const next = rate - value / derivative;
    if (next <= -0.999999 || !Number.isFinite(next)) break;
    if (Math.abs(next - rate) < 1e-10) return (1 + next) ** 12 - 1;
    rate = next;
  }
  let low = -0.999999;
  let high = 1;
  let lowValue = npv(low);
  let highValue = npv(high);
  while (lowValue * highValue > 0 && high < 1e6) {
    high *= 2;
    highValue = npv(high);
  }
  if (lowValue * highValue > 0) return null;
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    const midValue = npv(mid);
    if (Math.abs(midValue) < 1e-8) return (1 + mid) ** 12 - 1;
    if (lowValue * midValue <= 0) {
      high = mid;
      highValue = midValue;
    } else {
      low = mid;
      lowValue = midValue;
    }
  }
  return (1 + (low + high) / 2) ** 12 - 1;
}

export function calculateModel(rawInput) {
  const payroll = Number(rawInput.payroll ?? FIXED.payroll);
  const rent = Number(rawInput.rent ?? FIXED.rent);
  const input = {
    ...EXCEL_DEFAULTS,
    ...rawInput,
    rent,
    horizon: Math.max(1, Math.min(24, Math.round(Number(rawInput.horizon) || 1))),
    conversion: Number(rawInput.conversion),
    rawCogsShare: Number(rawInput.rawCogsShare),
  };
  const periods = [];
  for (let index = 0; index < input.horizon; index += 1) {
    const month = String.fromCharCode('C'.charCodeAt(0) + index);
    const revenue = input.traffic * input.hoursPerDay * input.operatingDays * input.conversion * input.averageCheck;
    const rawCogs = revenue * input.rawCogsShare;
    const packaging = revenue * FIXED.packagingShare;
    const sanitation = revenue * FIXED.sanitationShare;
    const logistics = revenue * FIXED.logisticsShare;
    const totalCogs = rawCogs + packaging + sanitation + logistics;
    const grossProfit = revenue - totalCogs;
    const aggregatorFees = revenue * FIXED.deliveryShare * FIXED.aggregatorFee;
    const opex = payroll + input.rent + FIXED.utilities + input.marketing + FIXED.admin;
    const ebitda = grossProfit - aggregatorFees - opex;
    const depreciation = FIXED.capex / FIXED.usefulLifeMonths;
    const ebit = ebitda - depreciation;
    const tax = Math.max(0, revenue * FIXED.usnRate);
    const netProfit = ebit - 0 - tax;

    const beginningBalance = index === 0 ? 0 : periods[index - 1].cash[65];
    const salesReceipts = revenue - aggregatorFees;
    const investment = index === 0 ? FIXED.capex : 0;
    const supplierPayments = rawCogs * (1 - FIXED.payableDays / 30);
    const payrollPayments = payroll * FIXED.payrollMultiplier;
    const rentAndUtilities = input.rent + FIXED.utilities;
    const totalInflows = salesReceipts;
    const totalOutflows = investment + supplierPayments + payrollPayments + rentAndUtilities + input.marketing + FIXED.admin + tax;
    const netCashFlow = totalInflows - totalOutflows;
    const endingBalance = beginningBalance + netCashFlow;
    const cumulativeCashFlow = index === 0 ? netCashFlow : periods[index - 1].cash[65] + netCashFlow;
    const date = monthDate(input.startDate, index);

    const pnl = {
      26: revenue, 27: rawCogs, 28: packaging, 29: sanitation, 30: logistics,
      31: totalCogs, 32: grossProfit, 33: revenue === 0 ? null : grossProfit / revenue,
      34: aggregatorFees, 35: payroll, 36: input.rent, 37: FIXED.utilities,
      38: input.marketing, 39: FIXED.admin, 40: opex, 41: ebitda, 42: depreciation,
      43: ebit, 44: 0, 45: tax, 46: netProfit, 47: revenue === 0 ? null : netProfit / revenue,
    };
    const cash = {
      52: beginningBalance, 53: salesReceipts, 54: investment, 55: supplierPayments,
      56: payrollPayments, 57: rentAndUtilities, 58: input.marketing, 59: FIXED.admin,
      60: tax, 61: totalInflows, 62: totalOutflows, 63: netCashFlow,
      64: endingBalance, 65: cumulativeCashFlow,
    };
    periods.push({ index, month, date, label: formatMonth(date), fullLabel: formatMonth(date, 'long'), pnl, cash });
  }

  const discountRatePerMonth = (1 + FIXED.annualDiscountRate) ** (1 / 12) - 1;
  // Excel: NPV(monthly rate, D63:Z63) + C63. Первое значение не дисконтируется.
  const npv = periods.reduce((total, period, index) => total + period.cash[63] / ((1 + discountRatePerMonth) ** index), 0);
  const minCumulative = Math.min(...periods.map((period) => period.cash[65]));
  const investmentNeed = Math.max(0, -minCumulative);
  const paybackIndex = periods.findIndex((period) => period.cash[65] > 0);
  const irrAnnualized = annualizedIRR(periods.map((period) => period.cash[63]));
  return { input, periods, npv, investmentNeed, paybackMonth: paybackIndex < 0 ? null : paybackIndex + 1, irrAnnualized, discountRatePerMonth };
}

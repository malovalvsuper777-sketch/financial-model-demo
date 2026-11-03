const EXPENSE_CATEGORIES = Object.freeze([
  { row: 27, label: 'Себестоимость сырья' },
  { row: 28, label: 'Себестоимость упаковки' },
  { row: 29, label: 'Санитария' },
  { row: 30, label: 'Логистика сырья' },
  { row: 34, label: 'Комиссии агрегаторов' },
  { row: 35, label: 'ФОТ' },
  { row: 36, label: 'Аренда' },
  { row: 37, label: 'Коммунальные услуги' },
  { row: 38, label: 'Маркетинг' },
  { row: 39, label: 'Прочие операционные расходы' },
  { row: 42, label: 'Амортизация' },
  { row: 44, label: 'Финансовые расходы' },
  { row: 45, label: 'Налоги УСН' },
]);

export const EXPENSE_PALETTE = Object.freeze([
  '#c8a96b', '#d9bd82', '#a98654', '#7da58d', '#5f9478', '#61c6a2', '#497f6b',
  '#a1b8a8', '#cb9166', '#8b9f91', '#d7c9aa', '#92a686', '#bd7773',
]);

function getPeriods(model, period) {
  if (period === 'total') return model.periods;
  const match = /^month:(\d+)$/.exec(period);
  if (!match) throw new Error('Выберите месяц или весь горизонт планирования.');
  const month = model.periods[Number(match[1])];
  if (!month) throw new Error('Выбранный месяц отсутствует в горизонте модели.');
  return [month];
}

export function calculateExpenseStructure(model, period = 'total') {
  const periods = getPeriods(model, period);
  const categories = EXPENSE_CATEGORIES.map((category, index) => {
    const amount = periods.reduce((sum, item) => sum + Number(item.pnl[category.row]), 0);
    if (!Number.isFinite(amount) || amount < -1e-8) {
      throw new Error(`Некорректная сумма статьи «${category.label}» в ОПиУ.`);
    }
    return { ...category, amount: Math.max(0, amount), color: EXPENSE_PALETTE[index] };
  });
  const total = categories.reduce((sum, category) => sum + category.amount, 0);
  if (!Number.isFinite(total)) throw new Error('Не удалось рассчитать общую сумму расходов.');

  if (total > 0) {
    const roundedTenths = categories.map(({ amount }) => Math.round(amount / total * 1000));
    const remainder = 1000 - roundedTenths.reduce((sum, value) => sum + value, 0);
    const largestIndex = categories.reduce((best, category, index) => category.amount > categories[best].amount ? index : best, 0);
    roundedTenths[largestIndex] += remainder;
    categories.forEach((category, index) => { category.share = roundedTenths[index] / 10; });
  } else {
    categories.forEach((category) => { category.share = 0; });
  }

  const largest = total > 0
    ? categories.reduce((best, category) => category.amount > best.amount ? category : best)
    : null;
  return { period, categories, total, largest, periodsCount: periods.length };
}

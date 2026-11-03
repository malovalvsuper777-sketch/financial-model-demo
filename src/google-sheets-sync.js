const SPREADSHEET_ID = '1rLnW66fi9fw-_P6rzoP1Wd-aiVTpMKs3ca2B1y0aaqM';
const PARAMETER_GID = '0';
const MODEL_GID = '93642183';
const FETCH_TIMEOUT_MS = 15_000;

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  if (quoted) throw new Error('CSV повреждён: не закрыта кавычка.');
  return rows;
}

export function parseLocalizedNumber(value, { percent = false } = {}) {
  const original = String(value ?? '').trim();
  const hasPercentSign = original.includes('%');
  let normalized = original.replace(/[\s\u00a0\u202f]/g, '').replace(/,/g, '.');
  normalized = normalized.replace(/[^0-9.+\-eE]/g, '');
  const number = Number(normalized);
  if (original === '' || !Number.isFinite(number)) throw new Error(`Неверное числовое значение «${original || 'пусто'}».`);
  return percent && hasPercentSign ? number / 100 : number;
}

function parseDate(value) {
  const text = String(value ?? '').trim();
  let match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
      throw new Error(`Некорректная дата в листе «Финмодель»: ${text}.`);
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const date = new Date(`${text}T00:00:00Z`);
    if (!Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === text) return text;
  }
  throw new Error(`Неверный формат даты в листе «Финмодель»: ${text || 'пусто'}.`);
}

function findParameterValue(rows, label) {
  const matches = rows.filter((row) => (row[1] || '').trim() === label);
  if (matches.length !== 1) throw new Error(`В листе «Параметры» нужно найти одну строку «${label}»; найдено: ${matches.length}.`);
  return matches[0][5];
}

function validateRange(label, value, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Параметр «${label}» вне допустимого диапазона (${min}–${max}).`);
  }
  return value;
}

function findModelValue(rows, labelPattern) {
  const row = rows.find((cells) => labelPattern.test(cells[0] || ''));
  if (!row) throw new Error(`На листе «Финмодель» не найден параметр «${labelPattern.source}».`);
  return row[1];
}

export function parseGoogleSourceCsv(parametersCsv, modelCsv) {
  const parameters = parseCsv(parametersCsv);
  const model = parseCsv(modelCsv);
  const payrollRows = parameters.filter((row) => (row[1] || '').trim() === 'ФОТ');
  if (payrollRows.length === 0) throw new Error('В листе «Параметры» не найдены строки ФОТ.');
  const payroll = payrollRows.reduce((total, row) => total + parseLocalizedNumber(row[5]), 0);
  const horizon = parseLocalizedNumber(findModelValue(model, /^Горизонт планирования/));
  if (!Number.isInteger(horizon)) throw new Error('Горизонт планирования должен быть целым числом месяцев.');

  return {
    startDate: parseDate(findModelValue(model, /^Дата старта/)),
    horizon: validateRange('Горизонт планирования', horizon, 1, 24),
    traffic: validateRange('Трафик', parseLocalizedNumber(findParameterValue(parameters, 'Трафик')), 0, 1e9),
    conversion: validateRange('Конверсия в покупку', parseLocalizedNumber(findParameterValue(parameters, 'Конверсия в покупку'), { percent: true }), 0, 1),
    averageCheck: validateRange('Средний чек', parseLocalizedNumber(findParameterValue(parameters, 'Средний чек')), 0, 1e9),
    hoursPerDay: validateRange('Часы работы в день', parseLocalizedNumber(findParameterValue(parameters, 'Часы/дни работы')), 0, 24),
    operatingDays: validateRange('Рабочих дней в месяце', parseLocalizedNumber(findParameterValue(parameters, 'Рабочих дней в месяце')), 0, 31),
    rawCogsShare: validateRange('Доля себестоимости в выручке', parseLocalizedNumber(findParameterValue(parameters, 'Доля себестоимости в выручке'), { percent: true }), 0, 1),
    marketing: validateRange('Маркетинг', parseLocalizedNumber(findParameterValue(parameters, 'Маркетинг')), 0, 1e12),
    payroll: validateRange('ФОТ', payroll, 0, 1e12),
  };
}

async function fetchCsv(gid, fetchImpl) {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`Google Таблицы ответили с кодом ${response.status}.`);
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchGoogleSourceInputs(fetchImpl = fetch) {
  try {
    const [parametersCsv, modelCsv] = await Promise.all([
      fetchCsv(PARAMETER_GID, fetchImpl),
      fetchCsv(MODEL_GID, fetchImpl),
    ]);
    return parseGoogleSourceCsv(parametersCsv, modelCsv);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Не удалось дождаться ответа Google Таблиц. Проверьте подключение и повторите попытку.');
    throw error;
  }
}

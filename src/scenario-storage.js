import { defaultAllScenarioParameters, SCENARIO_DEFINITIONS, SCENARIO_DRIVERS } from './scenarios.js';

export const SCENARIO_STORAGE_KEY = 'bakery-financial-model:scenario-settings:v1';

export function loadScenarioParameters(storage) {
  const defaults = defaultAllScenarioParameters();
  try {
    if (!storage) return defaults;
    const saved = storage.getItem(SCENARIO_STORAGE_KEY);
    if (saved === null) return defaults;
    const parsed = JSON.parse(saved);
    if (parsed?.version !== 1 || !parsed.scenarios || typeof parsed.scenarios !== 'object') return defaults;

    const restored = {};
    for (const { id } of SCENARIO_DEFINITIONS) {
      const scenario = parsed.scenarios[id];
      if (!scenario || typeof scenario !== 'object') return defaults;
      restored[id] = {};
      for (const driver of SCENARIO_DRIVERS) {
        const value = scenario[driver.id];
        if (typeof value !== 'number' || !Number.isFinite(value)
          || value < driver.min || (driver.max !== undefined && value > driver.max)) return defaults;
        restored[id][driver.id] = value;
      }
    }
    return restored;
  } catch {
    return defaults;
  }
}

export function saveScenarioParameters(parameters, storage) {
  try {
    if (!storage) return false;
    const scenarios = Object.fromEntries(SCENARIO_DEFINITIONS.map(({ id }) => [
      id,
      Object.fromEntries(SCENARIO_DRIVERS.map(({ id: driverId }) => [driverId, parameters[id][driverId]])),
    ]));
    storage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify({ version: 1, scenarios }));
    return true;
  } catch {
    return false;
  }
}

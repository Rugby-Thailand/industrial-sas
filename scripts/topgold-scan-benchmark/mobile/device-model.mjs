// Acquisition candidates are not validated identities. Expected answers are used
// only here, after decoding; they are never passed to a decoder or worker.
export const METHODS = {
  legacy: "JS เดิม + fallback · อ่านต่อเฟรม",
  native: "Native",
  wasm: "WASM · worker",
  mixed: "Native → WASM → ค้นหาบาร์โค้ดสินค้า",
};

export function fieldOf(symbol) {
  if (/^FO(?:M)?\d{4,}$/i.test(symbol.text.trim())) return "job";
  if (/^(Code128|CODE_128|code_128)$/.test(symbol.format || ""))
    return "product";
  // Match the old field routing for comparison, without inventing its format.
  // Non-JOB legacy fallback text is only a provisional product candidate.
  if (symbol.engine === "legacyFallback") return "product";
  return "other";
}

export function candidates(symbols) {
  const fields = { job: new Set(), product: new Set(), other: new Set() };
  for (const symbol of symbols) {
    const field = fieldOf(symbol);
    fields[field].add(
      field === "job" ? symbol.text.trim().toUpperCase() : symbol.text.trim(),
    );
  }
  return Object.fromEntries(
    Object.entries(fields).map(([key, set]) => [key, [...set]]),
  );
}

export function wantedFields(target) {
  return target === "both" ? ["job", "product"] : [target];
}

export function targetFound(target, symbols) {
  const fields = candidates(symbols);
  return wantedFields(target).every((field) => fields[field].length === 1);
}

export function scoreTrial(trial) {
  const fields = candidates(trial.symbols);
  const scores = Object.fromEntries(
    wantedFields(trial.target).map((field) => {
      let expected = trial.expected[field]?.trim();
      if (field === "job") expected = expected?.toUpperCase();
      const actual = fields[field];
      const verdict = !expected
        ? "unscored"
        : actual.length === 0
          ? "no-read"
          : actual.length > 1
            ? "ambiguous"
            : actual[0] === expected
              ? "correct"
              : "incorrect";
      return [field, verdict];
    }),
  );
  const values = Object.values(scores);
  const exact = values.every((value) => value === "correct");
  const scored = values.every((value) => value !== "unscored");
  // Interrupted and failed trials stay in the log, outside completed-test rates.
  const eligible = ["timeout", "manual", "photo-complete"].includes(
    trial.reason,
  );
  return { fields, scores, exact, scored, eligible };
}

export function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

export function summarise(trials) {
  const groups = new Map();
  for (const trial of trials) {
    const limitMs = trial.source === "camera" ? trial.limitMs : null;
    const key = `${trial.method}/${trial.source}/${trial.target}/${trial.maxSide}/${limitMs}`;
    if (!groups.has(key))
      groups.set(key, {
        key,
        method: trial.method,
        source: trial.source,
        target: trial.target,
        maxSide: trial.maxSide,
        limitMs,
        total: 0,
        completed: 0,
        scored: 0,
        correct: 0,
        noRead: 0,
        incorrect: 0,
        ambiguous: 0,
        interrupted: 0,
        hits: [],
        attempts: [],
      });
    const group = groups.get(key);
    const score = scoreTrial(trial);
    group.total++;
    if (!score.eligible) {
      group.interrupted++;
      continue;
    }
    group.completed++;
    if (score.scored) {
      group.scored++;
      if (score.exact) group.correct++;
      else if (Object.values(score.scores).includes("incorrect"))
        group.incorrect++;
      else if (Object.values(score.scores).includes("ambiguous"))
        group.ambiguous++;
      else group.noRead++;
      if (score.exact && trial.firstCompleteMs !== null)
        group.hits.push(trial.firstCompleteMs);
    }
    // Includes no-reads/errors inside an otherwise completed trial.
    group.attempts.push(...trial.attemptWallMs);
  }
  return [...groups.values()].map(({ hits, attempts, ...group }) => ({
    ...group,
    correctTimeP50: percentile(hits, 0.5),
    correctTimeP95: percentile(hits, 0.95),
    attemptP50: percentile(attempts, 0.5),
    attemptP95: percentile(attempts, 0.95),
  }));
}

export function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

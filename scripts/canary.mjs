export function percentile(ms, fraction) {
  if (ms.length === 0) return null;
  const sorted = [...ms].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

export function evaluateCanary(samples, candidate, elapsedMs) {
  const versioned = samples.filter(sample => sample.version === candidate);
  const unattributed = samples.filter(sample => !sample.version && sample.status >= 500).length;
  const errors = versioned.filter(sample => sample.status !== 200).length;
  const successes = versioned.filter(sample => sample.status === 200).map(sample => sample.ms);
  const p95 = percentile(successes, .95);
  const p99 = percentile(successes, .99);
  const durationOk = elapsedMs >= 300_000;
  const enough = versioned.length >= 100;
  const errorRate = versioned.length === 0 ? null : errors / versioned.length;
  const outcome = !durationOk || !enough ? "inconcluso" :
    unattributed || errorRate > .01 || p95 === null || p95 > 2000 ? "revertir" : "promover";
  return { outcome, elapsedMs, total: samples.length, candidateSamples: versioned.length, errors, unattributed, errorRate, p95, p99 };
}

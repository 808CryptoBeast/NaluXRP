// Lightweight Chart factory to standardize Chart.js options.
// Assumes Chart global or imported Chart available.

const DEFAULT_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 300 },
  plugins: { legend: { display: false } },
};

/**
 * createChart(canvasCtx, config)
 * config: { type, data, options }
 */
export function createChart(ctx, { type = "line", data = {}, options = {} } = {}) {
  if (typeof Chart === "undefined") {
    throw new Error("Chart.js not available. Include Chart.js or import it.");
  }
  const cfg = {
    type,
    data,
    options: mergeOptions(DEFAULT_OPTIONS, options),
  };
  return new Chart(ctx, cfg);
}

function mergeOptions(a, b) {
  return { ...a, ...b, plugins: { ...(a.plugins || {}), ...(b.plugins || {}) } };
}

/**
 * updateChartData(chart, newData)
 * replaces chart.data and updates
 */
export function updateChartData(chart, newData) {
  chart.data = newData;
  chart.update();
}
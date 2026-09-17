/* Helpers Plotly.js — reprennent la charte visuelle §8 du cahier des charges. */

const CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const CHART_BG = "#fcfcfb";
const GRID_COLOR = "#e1e0d9";

function verdictBarChart(elementId, counts) {
  const order = ["Achat fort", "À surveiller", "Écarter", "Données insuffisantes"];
  const labels = order.filter((o) => counts[o]);
  const values = labels.map((l) => counts[l]);
  const colors = labels.map((l) => VERDICT_COLORS[l] || "#898781");

  Plotly.newPlot(elementId, [{
    x: values, y: labels, type: "bar", orientation: "h", marker: { color: colors },
  }], {
    plot_bgcolor: CHART_BG, paper_bgcolor: CHART_BG,
    xaxis: { title: "Nombre de titres", gridcolor: GRID_COLOR, zerolinecolor: GRID_COLOR },
    yaxis: { title: null },
    margin: { l: 10, r: 10, t: 10, b: 30 }, height: 260, showlegend: false,
  }, { displayModeBar: false, responsive: true });
}

function radarChart(elementId, series) {
  const labels = Object.values(METRIC_LABELS);
  const keys = Object.keys(METRIC_LABELS);
  const single = series.length === 1;

  const traces = series.map((s) => {
    const vals = keys.map((k) => s.values[k] ?? 0);
    return {
      type: "scatterpolar",
      r: [...vals, vals[0]],
      theta: [...labels, labels[0]],
      fill: single ? "toself" : "none",
      fillcolor: single ? "rgba(42,120,214,0.25)" : undefined,
      line: { color: s.color, width: 2 },
      name: s.name,
      opacity: single ? 1 : 0.85,
    };
  });

  Plotly.newPlot(elementId, traces, {
    polar: {
      radialaxis: { visible: true, range: [0, 100], gridcolor: GRID_COLOR },
      angularaxis: { gridcolor: GRID_COLOR },
      bgcolor: CHART_BG,
    },
    showlegend: !single,
    legend: { orientation: "h", yanchor: "bottom", y: -0.15 },
    paper_bgcolor: CHART_BG,
    margin: { l: 40, r: 40, t: 20, b: 20 },
    height: single ? 380 : 460,
  }, { displayModeBar: false, responsive: true });
}

function allocationBarChart(elementId, rows) {
  Plotly.newPlot(elementId, [{
    x: rows.map((r) => r.poids_pct),
    y: rows.map((r) => r.ticker),
    type: "bar",
    orientation: "h",
    marker: { color: rows.length <= 8 ? CATEGORICAL.slice(0, rows.length) : "#2a78d6" },
    text: rows.map((r) => `${r.poids_pct.toFixed(1)}%`),
    textposition: "outside",
  }], {
    plot_bgcolor: CHART_BG, paper_bgcolor: CHART_BG,
    xaxis: { title: "Poids suggéré (%)", gridcolor: GRID_COLOR },
    yaxis: { title: null, autorange: "reversed" },
    margin: { l: 10, r: 10, t: 20, b: 10 },
    height: Math.max(240, 40 * rows.length),
    showlegend: false,
  }, { displayModeBar: false, responsive: true });
}

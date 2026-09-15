// Courbes d’Enderium : le codage du studio (scène « Courbe ») donne les mêmes couleurs que
// `ChartSeries.encode` côté serveur, pour chaque style ; bords des colonnes comme `ChartFrame.columnEdges`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHART_STYLES, chartColumnEdges, encodeChart } from '../src/shader/scenes.ts';

const SERIES = [12, 12.4, 12.1, 13, 13.8, 13.2, 12.6, 11.9, 12.2, 12.9, 13.5, 14.1];

// Relevé sur Enderium (ChartSeries.of(SERIES).encode(7, style)), le 2026-09-15.
const EXPECTED: Record<(typeof CHART_STYLES)[number], number[]> = {
  area: [2287366, 3682646, 9090130, 10651910, 4728370, 3248594, 9346251],
  line: [2287366, 3682646, 9090130, 10651910, 4728370, 3248594, 9346251],
  spark: [2287366, 3682646, 9090130, 10651910, 4728370, 3248594, 9346251],
  bars: [2286686, 3204638, 11638322, 7778004, 2286684, 8392706, 15097035],
  candles: [2417801, 3811467, 9079970, 10562066, 4768902, 3291340, 9412195],
  volume: [2308154, 3705570, 9085506, 10635510, 4731198, 3247870, 9365231],
};

test('chaque style est codé comme sur le serveur', () => {
  for (const style of CHART_STYLES) assert.deepEqual(encodeChart(SERIES, 7, style), EXPECTED[style], style);
});

test('la dernière colonne des styles à point final contient l’anneau du point', () => {
  const edges = chartColumnEdges(158, 34, 28, 'volume');
  assert.equal(edges.length, 29);
  assert.equal(edges[0], 0);
  assert.equal(edges[28], 158);
  assert.ok(Math.abs(edges[28] - edges[27] - (0.116 * 34 + 2)) < 1e-9);
  const bars = chartColumnEdges(73, 27, 12, 'bars');
  assert.ok(Math.abs(bars[12] - bars[11] - (bars[1] - bars[0])) < 1e-9, 'barres : colonnes égales');
});

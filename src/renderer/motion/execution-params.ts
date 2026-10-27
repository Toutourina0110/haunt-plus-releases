export interface ExecutionParams {
  shot2: number;
  shot3: number;
  shot4: number;
  shot5: number;
  shot6: number;
  shot7: number;
  shot8: number;
  end: number;
  saturation: number;
  vignette: number;
  bars: number;
  panelTilt: number;
  panelHeight: number;
  logoIn: number;
  heroSize: number;
  letterDrop: number;
  letterGap: number;
  letterScale: number;
  letterShake: number;
  stampTime: number;
  stampScale: number;
  stampTurn: number;
  zoom: number;
  strike1: number;
  strike2: number;
  strike3: number;
  cross: number;
  hitStop: number;
  impactFrames: number;
  shake: number;
  shakeDecay: number;
  splatter: number;
  strokeMin: number;
  strokeMax: number;
  cutGap: number;
  irisRadius: number;
  sheathe: number;
  chips: number;
  gravity: number;
  mangaLevels: number;
  mangaEdge: number;
  mangaDot: number;
  backToReal: number;
  barsOut: number;
}

const dark: ExecutionParams = {
  shot2: 0.35,
  shot3: 1.1,
  shot4: 2.0,
  shot5: 2.6,
  shot6: 3.8,
  shot7: 4.6,
  shot8: 5.5,
  end: 6.5,
  saturation: 0.25,
  vignette: 0.55,
  bars: 0.09,
  panelTilt: 12,
  panelHeight: 0.38,
  logoIn: 0.45,
  heroSize: 0.46,
  letterDrop: 0.07,
  letterGap: 0.04,
  letterScale: 1.8,
  letterShake: 2,
  stampTime: 0.09,
  stampScale: 1.6,
  stampTurn: -8,
  zoom: 1.25,
  strike1: 2.65,
  strike2: 3.05,
  strike3: 3.45,
  cross: 0.09,
  hitStop: 0.07,
  impactFrames: 0.034,
  shake: 10,
  shakeDecay: 0.14,
  splatter: 60,
  strokeMin: 0.04,
  strokeMax: 0.07,
  cutGap: 2,
  irisRadius: 0.3,
  sheathe: 4.45,
  chips: 220,
  gravity: 2600,
  mangaLevels: 4,
  mangaEdge: 1.4,
  mangaDot: 6,
  backToReal: 0.6,
  barsOut: 0.4,
};

export const EXECUTION: { dark: ExecutionParams; light: ExecutionParams } = {
  dark,
  light: { ...dark, saturation: 0.4, vignette: 0.3, mangaEdge: 0.9 },
};

export const INK_BLACK = '#0d0b0c';
export const PAPER = '#f4f1ea';
export const STAMP_RED = '#c8102e';

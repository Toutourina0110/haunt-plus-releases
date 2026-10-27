export interface DustParams {
  particles: number;
  sizeMin: number;
  sizeMax: number;
  logoCells: number;
  frontStart: number;
  frontEnd: number;
  frontSoft: number;
  attractStart: number;
  attractEnd: number;
  logoEnd: number;
  depositStart: number;
  depositEnd: number;
  depositStagger: number;
  fixStart: number;
  curl: number;
  drift: number;
  swirl: number;
  jitter: number;
  blur: number;
  darken: number;
  hold: number;
}

const dark: DustParams = {
  particles: 9000,
  sizeMin: 2,
  sizeMax: 3,
  logoCells: 700,
  frontStart: 0.04,
  frontEnd: 0.4,
  frontSoft: 0.03,
  attractStart: 0.2,
  attractEnd: 0.44,
  logoEnd: 0.58,
  depositStart: 0.56,
  depositEnd: 0.92,
  depositStagger: 0.16,
  fixStart: 0.86,
  curl: 700,
  drift: 450,
  swirl: 12,
  jitter: 1.5,
  blur: 16,
  darken: 0.45,
  hold: 0.42,
};

export const DUST: { dark: DustParams; light: DustParams } = {
  dark,
  light: { ...dark, particles: 7500, sizeMax: 3.2, darken: 0.1 },
};

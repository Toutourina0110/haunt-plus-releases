export interface PrismParams {
  bladeWidth: number;
  minBlades: number;
  maxBlades: number;
  camera: number;
  quarter: number;
  stagger: number;
  wave1: number;
  wave2: number;
  wave3: number;
  recede: number;
  gap: number;
  shadeBase: number;
  shadeAmp: number;
  hold: number;
}

const dark: PrismParams = {
  bladeWidth: 56,
  minBlades: 18,
  maxBlades: 40,
  camera: 2.2,
  quarter: 0.16,
  stagger: 0.14,
  wave1: 0.04,
  wave2: 0.32,
  wave3: 0.6,
  recede: 0.04,
  gap: 1.5,
  shadeBase: 0.5,
  shadeAmp: 0.5,
  hold: 0.6,
};

export const PRISM: { dark: PrismParams; light: PrismParams } = {
  dark,
  light: { ...dark, shadeBase: 0.75, shadeAmp: 0.25 },
};

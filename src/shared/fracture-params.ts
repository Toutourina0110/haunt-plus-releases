export interface FractureParams {
  shards: number;
  density: number;
  camera: number;
  impact: number;
  cracksStart: number;
  cracksEnd: number;
  crackAlpha: number;
  burstStart: number;
  burstEnd: number;
  burstStagger: number;
  speed: number;
  depth: number;
  gravity: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  drift: number;
  returnStart: number;
  returnEnd: number;
  returnStagger: number;
  healStart: number;
  shadeBase: number;
  shadeAmp: number;
  hold: number;
}

const dark: FractureParams = {
  shards: 160,
  density: 0.22,
  camera: 2.2,
  impact: 0.005,
  cracksStart: 0.02,
  cracksEnd: 0.16,
  crackAlpha: 0.35,
  burstStart: 0.14,
  burstEnd: 0.5,
  burstStagger: 0.1,
  speed: 0.55,
  depth: 900,
  gravity: 0.12,
  rotX: 70,
  rotY: 70,
  rotZ: 25,
  drift: 10,
  returnStart: 0.58,
  returnEnd: 0.96,
  returnStagger: 0.14,
  healStart: 0.88,
  shadeBase: 0.5,
  shadeAmp: 0.5,
  hold: 0.55,
};

export const FRACTURE: { dark: FractureParams; light: FractureParams } = {
  dark,
  light: { ...dark, crackAlpha: 0.25, shadeBase: 0.75, shadeAmp: 0.25 },
};

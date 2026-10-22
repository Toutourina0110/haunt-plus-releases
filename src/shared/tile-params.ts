export interface TileParams {
  duration: number;
  tiles: number;
  wave: number;
  curve: number;
  rotation: number;
  blur: number;
  radius: number;
}

export const DEFAULT_PARAMS: TileParams = {
  duration: 1300,
  tiles: 200,
  wave: 0.45,
  curve: 0.22,
  rotation: 10,
  blur: 16,
  radius: 4,
};

export const SPEED_MS = { fast: 900, medium: 1300, long: 2000 } as const;

export const PARAM_LIMITS: Record<keyof TileParams, [number, number]> = {
  duration: [600, 3000],
  tiles: [60, 400],
  wave: [0, 0.8],
  curve: [0, 0.6],
  rotation: [0, 40],
  blur: [0, 40],
  radius: [0, 10],
};

export function cleanParams(raw: unknown): TileParams {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_PARAMS };
  for (const key of Object.keys(PARAM_LIMITS) as Array<keyof TileParams>) {
    const value = src[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const [min, max] = PARAM_LIMITS[key];
    out[key] = Math.min(max, Math.max(min, value));
  }
  out.tiles = Math.round(out.tiles);
  return out;
}

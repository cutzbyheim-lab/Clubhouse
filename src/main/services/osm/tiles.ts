import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import type { Http } from './client';

/*
 * Web-Mercator raster tiles (the "slippy map" scheme) for two public sources:
 *
 *  - Elevation: AWS Terrain Tiles, Terrarium encoding (Open Data on AWS;
 *    built from USGS 3DEP in the US, SRTM and others elsewhere).
 *    height_m = R·256 + G + B/256 − 32768.
 *  - Aerial imagery: USGS National Map "Imagery Only" basemap (public domain,
 *    US coverage; tile path is /tile/{z}/{row}/{col}).
 *
 * Tiles are fetched once for a course's bounding box, decoded to RGBA, and
 * sampled synchronously afterwards.
 */

export const ELEVATION = {
  zoom: 15,
  url: (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  credit: 'Elevation: AWS Terrain Tiles (USGS 3DEP, SRTM and others)',
} as const;

export const IMAGERY = {
  zoom: 17,
  url: (z: number, x: number, y: number) => `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`,
  credit: 'Imagery: USGS The National Map (public domain)',
} as const;

const TILE = 256;
const MAX_TILES = 120;

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Fractional global pixel coordinates at zoom z. */
export function lonLatToPixel(lat: number, lon: number, z: number): [number, number] {
  const n = 2 ** z * TILE;
  const latR = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n];
}

export function pixelToLonLat(px: number, py: number, z: number): { lat: number; lon: number } {
  const n = 2 ** z * TILE;
  const lon = (px / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / n))) * 180) / Math.PI;
  return { lat, lon };
}

/** Decodes PNG or JPEG bytes to RGBA. */
export function decodeImage(buf: Uint8Array): { width: number; height: number; data: Uint8Array } {
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (isPng) {
    const png = PNG.sync.read(Buffer.from(buf));
    return { width: png.width, height: png.height, data: png.data };
  }
  const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 64 });
  return { width: img.width, height: img.height, data: img.data };
}

/** A tile with no detail (a "no data" placeholder) is treated as missing. */
function isBlank(data: Uint8Array): boolean {
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4 * 97) {
    const v = data[i] ?? 0;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min < 4;
}

export interface Raster {
  zoom: number;
  /** RGB at a lat/lon, bilinear; null where no tile covered it. For imagery. */
  rgb(lat: number, lon: number): [number, number, number] | null;
  /** Decodes each pixel to a number first, then interpolates. For encoded data such as elevation. */
  scalar(lat: number, lon: number, decode: (rgb: [number, number, number]) => number): number | null;
  /** Fraction of the requested tiles that arrived with data. */
  coverage: number;
}

export async function fetchRaster(http: Http, bbox: Bbox, src: { zoom: number; url: (z: number, x: number, y: number) => string }, opts: { skipBlank: boolean }): Promise<Raster | null> {
  const z = src.zoom;
  const [x0, y0] = lonLatToPixel(bbox.north, bbox.west, z).map((v) => Math.floor(v / TILE));
  const [x1, y1] = lonLatToPixel(bbox.south, bbox.east, z).map((v) => Math.floor(v / TILE));
  const wanted: [number, number][] = [];
  for (let x = x0!; x <= x1!; x++) for (let y = y0!; y <= y1!; y++) wanted.push([x, y]);
  if (wanted.length > MAX_TILES) return null;

  const tiles = new Map<string, Uint8Array>();
  const queue = [...wanted];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [x, y] = next;
      const buf = await http.getBuffer(src.url(z, x, y), 20_000).catch(() => null);
      if (!buf) continue;
      try {
        const img = decodeImage(buf);
        if (img.width !== TILE || img.height !== TILE) continue;
        if (opts.skipBlank && isBlank(img.data)) continue;
        tiles.set(`${x}/${y}`, img.data);
      } catch {
        // undecodable tile: leave it out
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (tiles.size === 0) return null;

  const px = (gx: number, gy: number): [number, number, number] | null => {
    const tx = Math.floor(gx / TILE);
    const ty = Math.floor(gy / TILE);
    const t = tiles.get(`${tx}/${ty}`);
    if (!t) return null;
    const i = ((gy - ty * TILE) * TILE + (gx - tx * TILE)) * 4;
    return [t[i]!, t[i + 1]!, t[i + 2]!];
  };
  return {
    zoom: z,
    coverage: tiles.size / wanted.length,
    rgb(lat, lon) {
      const [fx, fy] = lonLatToPixel(lat, lon, z);
      const gx = Math.floor(fx - 0.5);
      const gy = Math.floor(fy - 0.5);
      const ax = fx - 0.5 - gx;
      const ay = fy - 0.5 - gy;
      const a = px(gx, gy);
      const b = px(gx + 1, gy);
      const c = px(gx, gy + 1);
      const d = px(gx + 1, gy + 1);
      if (!a || !b || !c || !d) return a ?? b ?? c ?? d ?? null;
      return [0, 1, 2].map((k) => (a[k]! * (1 - ax) + b[k]! * ax) * (1 - ay) + (c[k]! * (1 - ax) + d[k]! * ax) * ay) as [number, number, number];
    },
    scalar(lat, lon, decode) {
      const [fx, fy] = lonLatToPixel(lat, lon, z);
      const gx = Math.floor(fx - 0.5);
      const gy = Math.floor(fy - 0.5);
      const ax = fx - 0.5 - gx;
      const ay = fy - 0.5 - gy;
      const v = [px(gx, gy), px(gx + 1, gy), px(gx, gy + 1), px(gx + 1, gy + 1)].map((p) => (p ? decode(p) : null));
      const [a, b, c, d] = v;
      if (a == null || b == null || c == null || d == null) return a ?? b ?? c ?? d ?? null;
      return (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay;
    },
  };
}

/** Terrarium-encoded height in metres. */
export const terrariumHeight = ([r, g, b]: [number, number, number]): number => r * 256 + g + b / 256 - 32768;

export function encodeJpeg(width: number, height: number, rgba: Uint8Array, quality = 82): Buffer {
  return jpeg.encode({ width, height, data: rgba }, quality).data;
}

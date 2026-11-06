import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import type { Http } from '../../src/main/services/osm/client';
import { pointInPoly, projector, type P } from '../../src/main/services/osm/geo';
import type { GolfFeatures } from '../../src/main/services/osm/parse';
import { pixelToLonLat } from '../../src/main/services/osm/tiles';

/*
 * A fake tile server that renders real PNG/JPEG tiles, so the whole
 * fetch → decode → sample pipeline runs exactly as it would against the
 * real services.
 *
 *  - Elevation (Terrarium PNG) from a known height function.
 *  - Aerial photo (JPEG) painted from the course's own features, displaced by
 *    a known "truth" shift so alignment can be verified.
 */

export const ORIGIN = { lat: 47.69, lon: -122.3 };
const proj = projector(ORIGIN);

/** Ground height: rises 5 m per 100 m northwards, plus a 6 m mound east of hole 1. */
export const groundHeight = (lat: number, lon: number): number => {
  const [x, y] = proj({ lat, lon });
  return 120 + 0.05 * y + 6 * Math.exp(-((x - 60) ** 2 + (y - 150) ** 2) / (2 * 40 ** 2));
};

function terrariumTile(z: number, tx: number, ty: number): Buffer {
  const png = new PNG({ width: 256, height: 256 });
  for (let row = 0; row < 256; row++) {
    for (let col = 0; col < 256; col++) {
      const { lat, lon } = pixelToLonLat(tx * 256 + col + 0.5, ty * 256 + row + 0.5, z);
      const v = groundHeight(lat, lon) + 32768;
      const i = (row * 256 + col) * 4;
      png.data[i] = Math.floor(v / 256);
      png.data[i + 1] = Math.floor(v % 256);
      png.data[i + 2] = Math.floor((v % 1) * 256);
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

export interface PhotoOptions {
  /** Where the real course is relative to the map, metres east/north. */
  truthShift: P;
  /** Paint bunkers and water? (false = a photo that contradicts the map) */
  hazards: boolean;
}

function photoTile(features: GolfFeatures, opts: PhotoOptions, z: number, tx: number, ty: number): Buffer {
  const toM = (list: { lat: number; lon: number }[][]) => list.map((poly) => poly.map(proj));
  const water = toM(features.water);
  const bunkers = toM(features.bunkers);
  const turf = [...toM(features.greens), ...toM(features.fairways), ...toM(features.tees)];
  const data = new Uint8Array(256 * 256 * 4);
  let seed = tx * 7919 + ty * 104729;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 18;
  for (let row = 0; row < 256; row++) {
    for (let col = 0; col < 256; col++) {
      const { lat, lon } = pixelToLonLat(tx * 256 + col + 0.5, ty * 256 + row + 0.5, z);
      const [mx, my] = proj({ lat, lon });
      const p: P = [mx - opts.truthShift[0], my - opts.truthShift[1]];
      let c: [number, number, number] = [62 + noise(), 98 + noise(), 58 + noise()]; // rough
      if (turf.some((poly) => pointInPoly(p, poly))) c = [96, 152, 78];
      if (opts.hazards && water.some((poly) => pointInPoly(p, poly))) c = [38, 66, 92];
      if (opts.hazards && bunkers.some((poly) => pointInPoly(p, poly))) c = [222, 206, 160];
      const i = (row * 256 + col) * 4;
      data[i] = Math.max(0, Math.min(255, c[0]));
      data[i + 1] = Math.max(0, Math.min(255, c[1]));
      data[i + 2] = Math.max(0, Math.min(255, c[2]));
      data[i + 3] = 255;
    }
  }
  return jpeg.encode({ width: 256, height: 256, data }, 90).data;
}

export function tileServer(features: GolfFeatures, photo: PhotoOptions | null, overpassJson?: unknown): Http & { requests: string[] } {
  const requests: string[] = [];
  return {
    requests,
    getJson: async () => [],
    postForm: async () => overpassJson,
    getBuffer: async (url) => {
      requests.push(url);
      let m = /terrarium\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url);
      if (m) return new Uint8Array(terrariumTile(Number(m[1]), Number(m[2]), Number(m[3])));
      m = /tile\/(\d+)\/(\d+)\/(\d+)$/.exec(url); // z / row / col
      if (m && photo) return new Uint8Array(photoTile(features, photo, Number(m[1]), Number(m[3]), Number(m[2])));
      return null;
    },
  };
}

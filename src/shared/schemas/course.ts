import { z } from 'zod';
import { Id, IsoTimestamp, Source, optionalText, shortText } from './common';

/**
 * Hole layout for the 3D visualizer, in a local frame measured in metres:
 * origin at the tee, +y toward the green, +x to the player's right.
 */
const Point = z.tuple([z.number().finite(), z.number().finite()]);
/** Closed outline (last point joins the first), simplified to at most 160 points. */
const Polygon = z.array(Point).min(3).max(160);

export const HoleGeometry = z.object({
  tee: Point,
  /** Path of play from tee to green centre; at least tee and green. */
  centerline: z.array(Point).min(2).max(8),
  fairwayWidthM: z.number().min(10).max(80),
  green: z.object({ center: Point, radiusM: z.number().min(5).max(30) }),
  hazards: z
    .array(
      z.object({
        kind: z.enum(['bunker', 'water']),
        center: Point,
        radiusM: z.number().min(2).max(80),
      }),
    )
    .max(16),
  /** Height of the green relative to the tee. */
  greenElevationM: z.number().min(-40).max(40),
  /**
   * Where the layout came from. 'map' layouts are real outlines from
   * OpenStreetMap and are drawn as mapped, on flat ground; 'generated'
   * (sample data) may add decorative terrain. Absent means 'generated'.
   */
  source: z.enum(['generated', 'map']).optional(),
  /** Real feature outlines in the same hole frame (map layouts only). */
  outlines: z
    .object({
      greens: z.array(Polygon).max(4),
      tees: z.array(Polygon).max(12),
      fairways: z.array(Polygon).max(12),
      bunkers: z.array(Polygon).max(40),
      water: z.array(Polygon).max(12),
    })
    .optional(),
  /** Mapped individual trees and points sampled inside mapped woods. */
  trees: z.array(Point).max(400).optional(),
  /**
   * Trees found in the hole's aerial photo: [x, y, crown radius m, height m, kind]
   * where kind 0 is broadleaf and 1 conifer. Position and crown size are read from
   * the photo; height is estimated from crown size (it can't be seen from above).
   * An empty list means the photo was searched and had no trees; absent means not searched.
   */
  photoTrees: z
    .array(z.tuple([z.number().finite(), z.number().finite(), z.number().min(0.5).max(12), z.number().min(1).max(40), z.union([z.literal(0), z.literal(1)])]))
    .max(1500)
    .optional(),
  /**
   * Measured ground height on a regular grid in the hole frame, in metres
   * relative to the tee. Row-major from (x0, y0), `cols` across (+x) and
   * `rows` up (+y). From public elevation data; absent if unavailable.
   */
  elevation: z
    .object({
      x0: z.number().finite(),
      y0: z.number().finite(),
      stepM: z.number().min(1).max(20),
      cols: z.number().int().min(2).max(400),
      rows: z.number().int().min(2).max(400),
      heights: z.array(z.number().finite().min(-300).max(300)).max(20000),
      source: z.string().max(120),
    })
    .refine((e) => e.heights.length === e.cols * e.rows, 'Elevation grid size mismatch')
    .optional(),
  /** Frame-space rectangle the hole's aerial photo covers: [x0, y0, x1, y1]. */
  imageryBounds: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  /** Result of checking the mapped outlines against the aerial photo. */
  check: z
    .object({
      verdict: z.enum(['match', 'partial', 'mismatch', 'unchecked']),
      detail: z.string().max(300),
    })
    .optional(),
});
export type HoleGeometry = z.infer<typeof HoleGeometry>;

export const Tee = z.object({
  id: Id,
  name: shortText(40),
  courseRating: z.number().min(50).max(85).nullable(),
  slopeRating: z.number().int().min(55).max(155).nullable(),
});
export type Tee = z.infer<typeof Tee>;

export const Hole = z.object({
  id: Id,
  number: z.number().int().min(1).max(18),
  par: z.number().int().min(3).max(6),
  strokeIndex: z.number().int().min(1).max(18).nullable(),
  geometry: HoleGeometry.nullable(),
  /** Length per tee id. */
  lengthsM: z.record(z.string(), z.number().min(50).max(750)),
});
export type Hole = z.infer<typeof Hole>;

export const Course = z.object({
  id: Id,
  name: shortText(100),
  location: optionalText(120),
  notes: optionalText(2000),
  source: Source,
  /** Credit required by the data source, for imported courses. */
  attribution: z.string().nullable(),
  createdAt: IsoTimestamp,
});
export type Course = z.infer<typeof Course>;

export const CourseDetail = Course.extend({
  tees: z.array(Tee),
  holes: z.array(Hole),
});
export type CourseDetail = z.infer<typeof CourseDetail>;

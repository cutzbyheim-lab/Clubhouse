import { z } from 'zod';
import { DATA_SOURCES } from '../constants';

export const Id = z.number().int().positive();
export const IsoDate = z.iso.date();
export const IsoTimestamp = z.iso.datetime({ precision: 3 });
export const Source = z.enum(DATA_SOURCES);

export const shortText = (max: number) => z.string().trim().min(1).max(max);
export const optionalText = (max: number) => z.string().trim().max(max).nullable();

/** A measured quantity: NULL when not captured, otherwise inside physical limits. */
export const measured = (min: number, max: number) => z.number().finite().min(min).max(max).nullable();

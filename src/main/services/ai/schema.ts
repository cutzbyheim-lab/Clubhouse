/*
 * JSON Schemas for OpenAI structured outputs (strict mode): every property is
 * required and no extras are allowed; "maybe" values are nullable instead of
 * optional. Ranges are enforced afterwards by Zod, where an out-of-range value
 * becomes null rather than failing the whole answer.
 */
import { CLUB_KINDS, HEAD_FINISHES, HEAD_STYLES, OFFSETS, PLAYER_CATEGORIES, SKILL_LEVELS, WEIGHTINGS } from '@shared/schemas';

type Schema = Record<string, unknown>;

const s = (description: string): Schema => ({ type: 'string', description });
const ns = (description: string): Schema => ({ type: ['string', 'null'], description });
const nn = (description: string): Schema => ({ type: ['number', 'null'], description });
const ni = (description: string): Schema => ({ type: ['integer', 'null'], description });
const b = (description: string): Schema => ({ type: 'boolean', description });
const e = (values: readonly string[], description: string): Schema => ({ type: 'string', enum: [...values], description });
const arr = (items: Schema, description: string): Schema => ({ type: 'array', items, description });
const obj = (properties: Record<string, Schema>, description?: string): Schema => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
  ...(description ? { description } : {}),
});

export const clubLookupSchema = obj({
  found: b('True only if this is a real, identifiable club model.'),
  make: s('Manufacturer, e.g. "TaylorMade". Empty if not found.'),
  model: s('Model name without the club number, e.g. "Qi10 Max". Empty if not found.'),
  releaseYear: ni('Year the model was released, if known.'),
  kind: e(CLUB_KINDS, 'Club type.'),
  clubName: s('The specific club, e.g. "Driver", "3 Wood", "4 Hybrid", "7 Iron", "56° Wedge", "Putter".'),
  playerCategory: e(PLAYER_CATEGORIES, 'Who the maker designed it for.'),
  construction: s('One sentence on how the head is built (materials, hollow/cavity/forged, adjustability).'),
  head: obj(
    {
      style: e(HEAD_STYLES, 'Closest generic head shape. Must match the club type (wood-* for drivers, woods and hybrids).'),
      volumeCc: nn('Head volume in cc for drivers, woods and hybrids if published; otherwise null.'),
      finish: e(HEAD_FINISHES, 'Main visible finish of the head.'),
      crownColor: ns('Main crown or body colour as #rrggbb if distinctive (e.g. a coloured crown), else null.'),
      offset: e(OFFSETS, 'Amount of offset.'),
      weighting: e(WEIGHTINGS, 'Where the design puts weight / bias.'),
      adjustableHosel: b('Has an adjustable loft/lie hosel.'),
    },
    'Shape facts used to draw a generic 3D illustration.',
  ),
  specOptions: arr(
    obj({
      label: s('Short label, e.g. "10.5°" or "7 Iron" or "56° / 10° bounce".'),
      loftDeg: nn('Published loft in degrees.'),
      lieDeg: nn('Published lie angle in degrees, or null if not published.'),
      lengthIn: nn('Published standard length in inches, or null.'),
      swingWeight: ns('Published swing weight like "D2", or null.'),
    }),
    'Published loft versions of this exact club. Only numbers found in sources.',
  ),
  stockShafts: arr(
    obj({
      make: s('Shaft maker.'),
      model: s('Shaft model.'),
      flexes: arr(e(['L', 'A', 'R', 'S', 'X', 'TX'], 'Flex'), 'Flexes offered.'),
      weightG: nn('Shaft weight in grams, or null.'),
    }),
    'Stock shaft options, if published.',
  ),
  designedFor: s('One sentence: the player the maker designed this club for.'),
  playerSignals: arr(s('One short point.'), '2–4 points on what choosing this club suggests about a golfer, phrased as tendencies.'),
  confidence: e(['high', 'medium', 'low'], 'How sure the identification and specs are.'),
  note: ns('Anything the golfer should double-check, or null.'),
});

export const bagAnalysisSchema = obj({
  headline: s('One sentence summing up the golfer this bag belongs to.'),
  skill: obj({
    level: e(SKILL_LEVELS, 'Likely level.'),
    handicapRange: s('Likely handicap range like "10–18", or "unclear".'),
    reasoning: s('Two or three sentences naming the clubs that point to it.'),
  }),
  swingSpeed: obj({
    driverSpeed: s('Likely driver swing speed as a range in the player\'s speed unit, e.g. "95–102 mph", or "unclear".'),
    basis: e(['measured', 'equipment', 'unclear'], '"measured" only if a measured club speed was provided.'),
    reasoning: s('Two or three sentences.'),
  }),
  ballFlight: obj({
    tendency: s('Short phrase, e.g. "Higher launch, protects against a slice".'),
    reasoning: s('Two or three sentences.'),
  }),
  traits: arr(
    obj({ title: s('Short title.'), detail: s('One or two sentences.'), clubs: arr(s('Club name exactly as given.'), 'Clubs behind this point.') }),
    '3–5 things the bag says about the golfer.',
  ),
  suggestions: arr(obj({ title: s('Short title.'), detail: s('One or two sentences.') }), '2–4 practical suggestions (gapping, set make-up, shafts, practice). No product adverts.'),
  caveats: s('One sentence on what this read can\'t know.'),
});

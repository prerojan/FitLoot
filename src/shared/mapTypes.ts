import z from "zod";

export const MapCoordinateSchema = z.tuple([z.number(), z.number()]);
export type MapCoordinate = z.infer<typeof MapCoordinateSchema>;

export const MapDirectionsProfileSchema = z.enum([
  "foot-walking",
  "cycling-regular",
  "driving-car",
]);
export type MapDirectionsProfile = z.infer<typeof MapDirectionsProfileSchema>;

export const MapAddressSchema = z.object({
  house_number: z.string().optional(),
  road: z.string().optional(),
  suburb: z.string().optional(),
  city: z.string().optional(),
  county: z.string().optional(),
  state: z.string().optional(),
  postcode: z.string().optional(),
  country: z.string().optional(),
});
export type MapAddress = z.infer<typeof MapAddressSchema>;

export const MapGeocodeResultSchema = z.object({
  place_id: z.union([z.number(), z.string()]),
  display_name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  address: MapAddressSchema.optional(),
  boundingbox: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .nullable()
    .optional(),
});
export type MapGeocodeResult = z.infer<typeof MapGeocodeResultSchema>;

export const MapDirectionsResponseSchema = z.object({
  distance: z.number(),
  duration: z.number(),
  geometry: z.array(MapCoordinateSchema),
  provider: z.enum(["openrouteservice", "fallback"]),
  used_fallback_route: z.boolean(),
});
export type MapDirectionsResponse = z.infer<typeof MapDirectionsResponseSchema>;

export const MapTileConfigSchema = z.object({
  center: MapCoordinateSchema,
  zoom: z.number(),
  maxZoom: z.number(),
  minZoom: z.number(),
  tileSize: z.number(),
  attribution: z.string(),
  tileUrlTemplate: z.string(),
});
export type MapTileConfig = z.infer<typeof MapTileConfigSchema>;

export const MapPoiSearchRequestSchema = z.object({
  center: MapCoordinateSchema,
  radius: z.number().int().positive().max(20_000).optional(),
  tags: z.record(z.string(), z.string()),
});
export type MapPoiSearchRequest = z.infer<typeof MapPoiSearchRequestSchema>;

export const MapPoiResultSchema = z.object({
  id: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  tags: z.record(z.string(), z.string()),
});
export type MapPoiResult = z.infer<typeof MapPoiResultSchema>;

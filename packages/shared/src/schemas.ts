import { z } from 'zod';

/** How a raw value was measured. `camera` reads a waterline height directly. */
export const measurementMethods = ['tap', 'echo', 'camera'] as const;
export const measurementMethodSchema = z.enum(measurementMethods);
export type MeasurementMethod = z.infer<typeof measurementMethodSchema>;

/** Calibration only makes sense for methods that map a raw value to litres via a fitted curve. */
export const calibrationMethods = ['tap', 'echo'] as const;
export const calibrationMethodSchema = z.enum(calibrationMethods);
export type CalibrationMethod = z.infer<typeof calibrationMethodSchema>;

/**
 * Buckets are modelled as a truncated cone. A cylinder is a frustum with equal diameters.
 * All dimensions are inside measurements in centimetres.
 */
export const frustumSchema = z.object({
  topDiameterCm: z.number().positive().max(500),
  bottomDiameterCm: z.number().positive().max(500),
  heightCm: z.number().positive().max(500),
});
export type Frustum = z.infer<typeof frustumSchema>;

export const containerInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** Shape is optional: the tap method works from calibration points alone. */
  shape: frustumSchema.nullable(),
  material: z.string().trim().max(40).nullable(),
});
export type ContainerInput = z.infer<typeof containerInputSchema>;

export const containerSchema = containerInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
});
export type Container = z.infer<typeof containerSchema>;

export const calibrationPointInputSchema = z.object({
  method: calibrationMethodSchema,
  knownLitres: z.number().min(0).max(1000),
  /** Hz for tap, cm (phone-to-surface distance) for echo. */
  measuredValue: z.number().finite(),
  recordingKey: z.string().max(200).nullable(),
});
export type CalibrationPointInput = z.infer<typeof calibrationPointInputSchema>;

export const calibrationPointSchema = calibrationPointInputSchema.extend({
  id: z.string(),
  containerId: z.string(),
  createdAt: z.string(),
});
export type CalibrationPoint = z.infer<typeof calibrationPointSchema>;

export const measurementInputSchema = z.object({
  method: measurementMethodSchema,
  rawValue: z.number().finite(),
  estimatedLitres: z.number().finite(),
  /** 0..1, method-specific heuristic. */
  confidence: z.number().min(0).max(1),
  recordingKey: z.string().max(200).nullable(),
});
export type MeasurementInput = z.infer<typeof measurementInputSchema>;

export const measurementSchema = measurementInputSchema.extend({
  id: z.string(),
  containerId: z.string(),
  createdAt: z.string(),
});
export type Measurement = z.infer<typeof measurementSchema>;

/** Free-form labels attached to a debug recording, e.g. { container: "10 L bucket", litres: 6 }. */
export const recordingLabelsSchema = z.record(
  z.string().max(40),
  z.union([z.string().max(200), z.number(), z.boolean()]),
);
export type RecordingLabels = z.infer<typeof recordingLabelsSchema>;

export const recordingSchema = z.object({
  key: z.string(),
  mode: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  sampleRate: z.number().nullable(),
  labels: recordingLabelsSchema,
  createdAt: z.string(),
});
export type Recording = z.infer<typeof recordingSchema>;

/** Modes that learn from labelled examples the user records. */
export const exampleModes = ['knock', 'alert', 'fruit'] as const;
export type ExampleMode = (typeof exampleModes)[number];

/** JSON payloads stay small: feature vectors and fingerprints, not audio. */
export const MAX_EXAMPLE_DATA_CHARS = 64 * 1024;

export const exampleInputSchema = z.object({
  mode: z.enum(exampleModes),
  label: z.string().trim().min(1).max(60),
  data: z
    .record(z.string(), z.unknown())
    .refine((d) => JSON.stringify(d).length <= MAX_EXAMPLE_DATA_CHARS, 'data too large'),
  recordingKey: z.string().max(200).nullable().default(null),
});
export type ExampleInput = z.input<typeof exampleInputSchema>;

export const exampleSchema = z.object({
  id: z.string(),
  mode: z.enum(exampleModes),
  label: z.string(),
  data: z.record(z.string(), z.unknown()),
  recordingKey: z.string().nullable(),
  createdAt: z.string(),
});
export type Example = z.infer<typeof exampleSchema>;

import {
  DEVICE_ID_HEADER,
  type CalibrationPoint,
  type CalibrationPointInput,
  type Container,
  type ContainerInput,
  type Example,
  type ExampleInput,
  type ExampleMode,
  type HealthResponse,
  type Measurement,
  type MeasurementInput,
  type Recording,
  type RecordingLabels,
  type RecordingMode,
} from '@senselab/shared';
import { deviceId } from './device';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set(DEVICE_ID_HEADER, deviceId());
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  const res = await fetch(`/api${path}`, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export type ContainerDetail = Container & {
  calibration: CalibrationPoint[];
  measurements: Measurement[];
};

export const api = {
  health: () => request<HealthResponse>('/health'),
  listContainers: () => request<Container[]>('/containers'),
  getContainer: (id: string) => request<ContainerDetail>(`/containers/${id}`),
  createContainer: (input: ContainerInput) =>
    request<Container>('/containers', { method: 'POST', body: JSON.stringify(input) }),
  updateContainer: (id: string, input: ContainerInput) =>
    request<Container>(`/containers/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteContainer: (id: string) => request<void>(`/containers/${id}`, { method: 'DELETE' }),
  addCalibration: (id: string, input: CalibrationPointInput) =>
    request<CalibrationPoint>(`/containers/${id}/calibration`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteCalibration: (id: string, pointId: string) =>
    request<void>(`/containers/${id}/calibration/${pointId}`, { method: 'DELETE' }),
  addMeasurement: (id: string, input: MeasurementInput) =>
    request<Measurement>(`/containers/${id}/measurements`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  listRecordings: () => request<Recording[]>('/recordings'),
  uploadRecording: (
    blob: Blob,
    opts: { mode: RecordingMode; labels: RecordingLabels; sampleRate?: number },
  ) => {
    const q = new URLSearchParams({ mode: opts.mode, labels: JSON.stringify(opts.labels) });
    if (opts.sampleRate) q.set('sampleRate', String(opts.sampleRate));
    return request<Recording>(`/recordings?${q}`, {
      method: 'POST',
      body: blob,
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    });
  },
  recordingDataUrl: (key: string) => `/api/recordings/${key}/data`,
  fetchRecording: async (key: string) => {
    const res = await fetch(`/api/recordings/${key}/data`, {
      headers: { [DEVICE_ID_HEADER]: deviceId() },
    });
    if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
    return res.arrayBuffer();
  },
  deleteRecording: (key: string) => request<void>(`/recordings/${key}`, { method: 'DELETE' }),
  listExamples: (mode: ExampleMode) => request<Example[]>(`/examples?mode=${mode}`),
  addExample: (input: ExampleInput) =>
    request<Example>('/examples', { method: 'POST', body: JSON.stringify(input) }),
  deleteExample: (id: string) => request<void>(`/examples/${id}`, { method: 'DELETE' }),
  deleteExampleLabel: (mode: ExampleMode, label: string) =>
    request<{ deleted: number }>(`/examples?mode=${mode}&label=${encodeURIComponent(label)}`, {
      method: 'DELETE',
    }),
};

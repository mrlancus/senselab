import type {
  CalibrationPoint,
  Example,
  ExampleInput,
  ExampleMode,
  CalibrationPointInput,
  Container,
  ContainerInput,
  Measurement,
  MeasurementInput,
  Recording,
  RecordingLabels,
} from '@senselab/shared';

interface ContainerRow {
  id: string;
  name: string;
  top_diameter_cm: number | null;
  bottom_diameter_cm: number | null;
  height_cm: number | null;
  material: string | null;
  created_at: string;
}

interface CalibrationRow {
  id: string;
  container_id: string;
  method: CalibrationPoint['method'];
  known_litres: number;
  measured_value: number;
  recording_key: string | null;
  created_at: string;
}

interface MeasurementRow {
  id: string;
  container_id: string;
  method: Measurement['method'];
  raw_value: number;
  estimated_litres: number;
  confidence: number;
  recording_key: string | null;
  created_at: string;
}

interface RecordingRow {
  id: string;
  r2_key: string;
  mode: string;
  content_type: string;
  size_bytes: number;
  sample_rate: number | null;
  labels: string;
  created_at: string;
}

interface ExampleRow {
  id: string;
  mode: ExampleMode;
  label: string;
  data: string;
  recording_key: string | null;
  created_at: string;
}

function toExample(r: ExampleRow): Example {
  return {
    id: r.id,
    mode: r.mode,
    label: r.label,
    data: JSON.parse(r.data) as Record<string, unknown>,
    recordingKey: r.recording_key,
    createdAt: r.created_at,
  };
}

function toContainer(r: ContainerRow): Container {
  const hasShape = r.top_diameter_cm != null && r.bottom_diameter_cm != null && r.height_cm != null;
  return {
    id: r.id,
    name: r.name,
    shape: hasShape
      ? {
          topDiameterCm: r.top_diameter_cm!,
          bottomDiameterCm: r.bottom_diameter_cm!,
          heightCm: r.height_cm!,
        }
      : null,
    material: r.material,
    createdAt: r.created_at,
  };
}

const toCalibration = (r: CalibrationRow): CalibrationPoint => ({
  id: r.id,
  containerId: r.container_id,
  method: r.method,
  knownLitres: r.known_litres,
  measuredValue: r.measured_value,
  recordingKey: r.recording_key,
  createdAt: r.created_at,
});

const toMeasurement = (r: MeasurementRow): Measurement => ({
  id: r.id,
  containerId: r.container_id,
  method: r.method,
  rawValue: r.raw_value,
  estimatedLitres: r.estimated_litres,
  confidence: r.confidence,
  recordingKey: r.recording_key,
  createdAt: r.created_at,
});

const toRecording = (r: RecordingRow): Recording => ({
  key: r.id,
  mode: r.mode,
  contentType: r.content_type,
  sizeBytes: r.size_bytes,
  sampleRate: r.sample_rate,
  labels: JSON.parse(r.labels) as RecordingLabels,
  createdAt: r.created_at,
});

/** All queries are scoped by owner so one device can never read another's rows. */
export class Repo {
  constructor(
    private readonly db: D1Database,
    private readonly ownerId: string,
  ) {}

  async listContainers(): Promise<Container[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM containers WHERE device_id = ? ORDER BY created_at DESC')
      .bind(this.ownerId)
      .all<ContainerRow>();
    return results.map(toContainer);
  }

  async getContainer(id: string): Promise<Container | null> {
    const row = await this.db
      .prepare('SELECT * FROM containers WHERE id = ? AND device_id = ?')
      .bind(id, this.ownerId)
      .first<ContainerRow>();
    return row ? toContainer(row) : null;
  }

  async createContainer(input: ContainerInput): Promise<Container> {
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO containers (id, device_id, name, top_diameter_cm, bottom_diameter_cm, height_cm, material)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        this.ownerId,
        input.name,
        input.shape?.topDiameterCm ?? null,
        input.shape?.bottomDiameterCm ?? null,
        input.shape?.heightCm ?? null,
        input.material,
      )
      .run();
    return (await this.getContainer(id))!;
  }

  async updateContainer(id: string, input: ContainerInput): Promise<Container | null> {
    const res = await this.db
      .prepare(
        `UPDATE containers SET name = ?, top_diameter_cm = ?, bottom_diameter_cm = ?, height_cm = ?, material = ?
         WHERE id = ? AND device_id = ?`,
      )
      .bind(
        input.name,
        input.shape?.topDiameterCm ?? null,
        input.shape?.bottomDiameterCm ?? null,
        input.shape?.heightCm ?? null,
        input.material,
        id,
        this.ownerId,
      )
      .run();
    return res.meta.changes ? this.getContainer(id) : null;
  }

  async deleteContainer(id: string): Promise<boolean> {
    const res = await this.db
      .prepare('DELETE FROM containers WHERE id = ? AND device_id = ?')
      .bind(id, this.ownerId)
      .run();
    return res.meta.changes > 0;
  }

  async listCalibration(containerId: string): Promise<CalibrationPoint[]> {
    const { results } = await this.db
      .prepare(
        `SELECT p.* FROM calibration_points p JOIN containers c ON c.id = p.container_id
         WHERE p.container_id = ? AND c.device_id = ? ORDER BY p.created_at`,
      )
      .bind(containerId, this.ownerId)
      .all<CalibrationRow>();
    return results.map(toCalibration);
  }

  /** Caller must have checked the container belongs to the owner. */
  async addCalibration(
    containerId: string,
    input: CalibrationPointInput,
  ): Promise<CalibrationPoint> {
    const id = crypto.randomUUID();
    const row = await this.db
      .prepare(
        `INSERT INTO calibration_points (id, container_id, method, known_litres, measured_value, recording_key)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .bind(
        id,
        containerId,
        input.method,
        input.knownLitres,
        input.measuredValue,
        input.recordingKey,
      )
      .first<CalibrationRow>();
    return toCalibration(row!);
  }

  async deleteCalibration(containerId: string, pointId: string): Promise<boolean> {
    const res = await this.db
      .prepare(
        `DELETE FROM calibration_points WHERE id = ? AND container_id = ?
         AND container_id IN (SELECT id FROM containers WHERE device_id = ?)`,
      )
      .bind(pointId, containerId, this.ownerId)
      .run();
    return res.meta.changes > 0;
  }

  async listMeasurements(containerId: string, limit = 50): Promise<Measurement[]> {
    const { results } = await this.db
      .prepare(
        `SELECT m.* FROM measurements m JOIN containers c ON c.id = m.container_id
         WHERE m.container_id = ? AND c.device_id = ? ORDER BY m.created_at DESC LIMIT ?`,
      )
      .bind(containerId, this.ownerId, limit)
      .all<MeasurementRow>();
    return results.map(toMeasurement);
  }

  /** Caller must have checked the container belongs to the owner. */
  async addMeasurement(containerId: string, input: MeasurementInput): Promise<Measurement> {
    const id = crypto.randomUUID();
    const row = await this.db
      .prepare(
        `INSERT INTO measurements (id, container_id, method, raw_value, estimated_litres, confidence, recording_key)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .bind(
        id,
        containerId,
        input.method,
        input.rawValue,
        input.estimatedLitres,
        input.confidence,
        input.recordingKey,
      )
      .first<MeasurementRow>();
    return toMeasurement(row!);
  }

  async listRecordings(limit = 100): Promise<Recording[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM recordings WHERE device_id = ? ORDER BY created_at DESC LIMIT ?')
      .bind(this.ownerId, limit)
      .all<RecordingRow>();
    return results.map(toRecording);
  }

  async getRecording(id: string): Promise<(Recording & { r2Key: string }) | null> {
    const row = await this.db
      .prepare('SELECT * FROM recordings WHERE id = ? AND device_id = ?')
      .bind(id, this.ownerId)
      .first<RecordingRow>();
    return row ? { ...toRecording(row), r2Key: row.r2_key } : null;
  }

  async addRecording(rec: {
    id: string;
    r2Key: string;
    mode: string;
    contentType: string;
    sizeBytes: number;
    sampleRate: number | null;
    labels: RecordingLabels;
  }): Promise<Recording> {
    const row = await this.db
      .prepare(
        `INSERT INTO recordings (id, device_id, r2_key, mode, content_type, size_bytes, sample_rate, labels)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .bind(
        rec.id,
        this.ownerId,
        rec.r2Key,
        rec.mode,
        rec.contentType,
        rec.sizeBytes,
        rec.sampleRate,
        JSON.stringify(rec.labels),
      )
      .first<RecordingRow>();
    return toRecording(row!);
  }

  async deleteRecording(id: string): Promise<boolean> {
    const res = await this.db
      .prepare('DELETE FROM recordings WHERE id = ? AND device_id = ?')
      .bind(id, this.ownerId)
      .run();
    return res.meta.changes > 0;
  }

  async listExamples(mode: ExampleMode): Promise<Example[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM examples WHERE device_id = ? AND mode = ? ORDER BY created_at')
      .bind(this.ownerId, mode)
      .all<ExampleRow>();
    return results.map(toExample);
  }

  async addExample(input: ExampleInput & { recordingKey: string | null }): Promise<Example> {
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        'INSERT INTO examples (id, device_id, mode, label, data, recording_key) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(
        id,
        this.ownerId,
        input.mode,
        input.label,
        JSON.stringify(input.data),
        input.recordingKey,
      )
      .run();
    const row = await this.db
      .prepare('SELECT * FROM examples WHERE id = ?')
      .bind(id)
      .first<ExampleRow>();
    return toExample(row!);
  }

  async deleteExample(id: string): Promise<boolean> {
    const r = await this.db
      .prepare('DELETE FROM examples WHERE id = ? AND device_id = ?')
      .bind(id, this.ownerId)
      .run();
    return r.meta.changes > 0;
  }

  async deleteExampleLabel(mode: ExampleMode, label: string): Promise<number> {
    const r = await this.db
      .prepare('DELETE FROM examples WHERE device_id = ? AND mode = ? AND label = ?')
      .bind(this.ownerId, mode, label)
      .run();
    return r.meta.changes;
  }
}

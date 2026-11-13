export interface Component {
  id: string;
  name: string;
  code: string;
  position: [number, number] | null;
  norm_hours: number | null;
  installed_at: string | null;
  norm_source: string;
  last_replacement: InspectionEvent | null;
  events_count: number;
  quantity?: number;
  externally_visible?: boolean;
  ar_anchor?: boolean;
  note?: string | null;
}
export interface Equipment {
  id: string;
  equipment_type: string;
  type_name: string;
  name: string;
  model: string | null;
  location: string;
  serial: string | null;
  source: string;
  documented: boolean;
  inspectable: boolean;
  scenarios_available: boolean;
  medium: string;
  power_kw: number | null;
  speed_rpm: number | null;
  commissioned_at: string | null;
  commissioned_at_status?: string;
  commissioned_at_note?: string | null;
  parameters?: Record<string, unknown>;
  documents?: string[];
  limitations?: string[];
  notice: string;
  components: Component[];
}
export interface CatalogObject {
  id: string;
  equipment_type: string;
  type_name: string;
  name: string;
  model: string | null;
  serial: string | null;
  source: string;
  documented: boolean;
  inspectable: boolean;
  scenarios_available: boolean;
}
export interface CatalogType {
  id: string;
  name: string;
  documented: boolean;
  component_count: number;
  applicable_defect_classes: string[];
}
export interface Catalog {
  types: CatalogType[];
  objects: CatalogObject[];
  default_object_id: string;
}
export interface Scenario {
  id: string;
  title: string;
  description: string;
}
export interface Observation {
  kind: string;
  present?: boolean;
  value?: number;
  source: string;
  timestamp: string;
  component_id: string;
  description?: string;
  bbox?: [number, number, number, number] | null;
}
export interface Alert {
  id: string;
  rule_ids: string[];
  title: string;
  component_id: string;
  severity: "critical" | "warning" | "info";
  hypothesis: string;
  recommendation: string;
  evidence: {
    label: string;
    value: string | number;
    threshold: string | number;
    source: string;
  }[];
  requires_inspection: boolean;
}
export interface Telemetry {
  timestamp: string;
  source: string;
  runtime_hours: number | null;
  last_service_hours: number | null;
  baseline: Record<string, number>;
  samples: (Record<string, number | string | null> & { at: string })[];
}
export interface Analysis {
  id: string;
  created_at: string;
  equipment_id?: string;
  equipment_type?: string;
  scenario_id: string | null;
  scenario_title: string;
  telemetry: Telemetry;
  observations: Observation[];
  vision_id: string | null;
  image_id?: string | null;
  evaluation: {
    alerts: Alert[];
    rule_results: {
      id: string;
      status: "triggered" | "clear" | "insufficient" | "not_applicable";
      missing: string[];
      reason?: string;
    }[];
    features: Record<string, unknown>;
    source: string;
    maintenance: {
      runtime_hours: number | null;
      norm_hours: number;
      remaining_hours: number | null;
      next_service_hours: number | null;
      due_in_hours: number | null;
    };
  };
}
export interface VisionResult {
  id: string;
  quality: "good" | "limited" | "unreadable";
  summary: string;
  observations: Observation[];
  model: string;
  source: string;
}
export interface InspectionEvent {
  id: string;
  created_at: string;
  analysis_id: string;
  equipment_id?: string;
  component_id: string;
  action: string;
  notes: string;
  author: string;
  analysis: Analysis;
}
export interface SeriesChannel {
  key: string;
  label: string;
  unit: string;
  raw_header: string;
}
export interface ReferenceSeries {
  id: string;
  title: string;
  category: string;
  source: string;
  equipment_id: null;
  channels: SeriesChannel[];
  record_count: number;
  sheet: string;
  source_time: {
    first_raw: string;
    last_raw: string;
    timezone: string | null;
  };
  limitations: string[];
}
export interface ThresholdChannel {
  id: string;
  name: string;
  unit: string;
  warning?: number;
  alarm?: number;
  baseline?: number;
  hypothesis?: string;
}
export interface OrganizerAssessment extends ThresholdChannel {
  value: number | null;
  status: "above_alarm" | "above_warning" | "below_warning" | "unknown";
  source: string;
}
export interface SeriesWindow extends ReferenceSeries {
  start_index: number;
  end_index: number;
  evaluation_time: string;
  telemetry: {
    timestamp: string;
    source: string;
    time_basis: string;
    timestamp_is_technical: boolean;
    samples: (Record<string, number | string | null> & { at: string })[];
  };
  records: {
    index: number;
    raw_date: string;
    annotation: string | null;
    values: Record<string, number | null>;
  }[];
  organizer_assessment: OrganizerAssessment[];
}
export interface SeriesCatalog {
  series: ReferenceSeries[];
  thresholds: {
    channels: ThresholdChannel[];
    document_ids: string[];
    applies_to_status: string;
    conflicts_with_project: string[];
  };
}
export interface LibraryEntry {
  id: string;
  category: string;
  shows: string;
  view: string;
  view_label: string;
  provenance: string;
  provenance_label: string;
  editing: string;
  training_use: "candidate" | "illustration_only" | "excluded";
  training_use_label: string;
  note: string;
  duplicate_of: string | null;
  subject?: string | null;
  bytes: number;
  media_type: string | null;
  viewable_in_browser: boolean;
  original_name: string;
}
export interface Library {
  images: LibraryEntry[];
  documents: LibraryEntry[];
  series: LibraryEntry[];
  totals: {
    files: number;
    images: number;
    unique_images: number;
    training_candidates: number;
    documents: number;
  };
  notice: string;
}
export interface Bootstrap {
  catalog: Catalog;
  equipment: Equipment;
  scenarios: Scenario[];
  vision: { configured: boolean; model: string; provider: string };
}

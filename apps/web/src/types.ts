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
export interface Bootstrap {
  catalog: Catalog;
  equipment: Equipment;
  scenarios: Scenario[];
  vision: { configured: boolean; model: string; provider: string };
}

/**
 * R&D Project: Two-Layer Injury Extraction Pipeline
 * 
 * Layer 1 Evidence Extraction Schema
 * This schema defines the structure for evidence extracted from unstructured notes.
 */

export const ALLOWED_INJURIES = [
  'abrasion',
  'bleeding',
  'broken skin',
  'bruising',
  'bruise',
  'burn',
  'cut',
  'contusion',
  'dislocation',
  'fracture',
  'frostbite',
  'hematoma',
  'hypoglycemia',
  'incision',
  'laceration',
  'pain',
  'redness',
  'scratches',
  'skin tear',
  'scrape',
  'sprain',
  'strain',
  'swelling',
  'unconscious',
] as const;

export type AllowedInjury = typeof ALLOWED_INJURIES[number];

export type TemporalRelation = 'post_fall' | 'during_fall' | 'pre_fall' | 'unknown';
export type Certainty = 'explicit' | 'implied' | 'unclear';

export interface InjuryMention {
  /** Exact quoted substring from the note */
  text: string;
  /** One of Allowed_Injuries OR null if not directly mappable */
  injury_candidate: AllowedInjury | null;
  /** Body site if mentioned (e.g., "right forearm") */
  body_site: string | null;
  /** Whether this mention is negated */
  is_negated: boolean;
  /** Exact quote that negates it, if applicable */
  negation_text: string | null;
  /** Temporal relation to the fall event */
  temporal_relation_to_fall: TemporalRelation;
  /** How certain we are about this being an injury */
  certainty: Certainty;
  /** Best-effort character start position in original note */
  start_char: number;
  /** Best-effort character end position in original note */
  end_char: number;
}

export interface Negation {
  /** Exact negation phrase (e.g., "denies pain", "no bruising") */
  text: string;
  /** Substring it negates if available */
  scope_hint: string | null;
  /** Character start position */
  start_char: number;
  /** Character end position */
  end_char: number;
}

export interface NoInjuryStatement {
  /** Exact phrase like "no injuries noted", "no injury identified" */
  text: string;
  /** Character start position */
  start_char: number;
  /** Character end position */
  end_char: number;
}

export interface TimingMarker {
  /** Timing phrase like "post fall", "after fall", "found on floor" */
  text: string;
  /** Character start position */
  start_char: number;
  /** Character end position */
  end_char: number;
}

export interface BodySite {
  /** Body site mention (e.g., "right forearm", "left knee") */
  text: string;
  /** Character start position */
  start_char: number;
  /** Character end position */
  end_char: number;
}

export interface EvidenceMetadata {
  /** Model version used for extraction */
  model_version: string;
  /** Warnings about the extraction (e.g., "note is highly narrative") */
  extraction_warnings: string[];
}

export interface Layer1Evidence {
  /** Array of injury-related mentions found in the note */
  injury_mentions: InjuryMention[];
  /** Array of negation phrases */
  negations: Negation[];
  /** Array of explicit "no injury" statements */
  no_injury_statements: NoInjuryStatement[];
  /** Array of timing markers relative to the fall */
  timing_markers: TimingMarker[];
  /** Array of body site mentions */
  body_sites: BodySite[];
  /** Metadata about the extraction */
  metadata: EvidenceMetadata;
}

/**
 * Example Layer 1 evidence structure (all empty/null for reference)
 */
export const EXAMPLE_LAYER1_EVIDENCE: Layer1Evidence = {
  injury_mentions: [],
  negations: [],
  no_injury_statements: [],
  timing_markers: [],
  body_sites: [],
  metadata: {
    model_version: 'claude-sonnet-4-5-20250929',
    extraction_warnings: [],
  },
};

/**
 * Final output format (same as existing system)
 */
export interface FinalInjury {
  phrase: string;
  matched_injury: AllowedInjury;
}

export type FinalInjuries = FinalInjury[] | [];
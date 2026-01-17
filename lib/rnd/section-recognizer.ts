/**
 * R&D Project: Two-Layer Injury Extraction Pipeline
 * 
 * Optional Section Recognizer (Preprocessor)
 * Splits notes into relevant segments to reduce input entropy before sending to LLM.
 * Works across tenants, not per-tenant rules.
 */

export interface NoteSegment {
  /** The text content of the segment */
  text: string;
  /** Character offset in the original note where this segment starts */
  startOffset: number;
  /** Character offset in the original note where this segment ends */
  endOffset: number;
  /** Type/category of the segment (e.g., "assessment", "injury", "vitals") */
  category: string | null;
}

/**
 * Common patterns for recognizing sections in medical notes
 */
const SECTION_PATTERNS = {
  headings: /^(?:Assessment|Injury|Injuries|Skin|Vitals|Vital Signs|Neuro|Neurological|Intervention|Interventions|Plan|Notes?|Comment|Findings|Observation|Observations):?\s*/i,
  bulletLike: /^[-•*]\s+/,
  colonSeparated: /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*:\s*/,
  numbered: /^\d+[\.)]\s+/,
};

/**
 * Keywords that indicate injury-relevant sections
 */
const INJURY_RELEVANT_KEYWORDS = [
  'assessment',
  'injury',
  'injuries',
  'skin',
  'vitals',
  'vital signs',
  'neuro',
  'neurological',
  'intervention',
  'interventions',
  'finding',
  'findings',
  'observation',
  'observations',
  'post fall',
  'after fall',
  'found',
  'noted',
  'observed',
  'abrasion',
  'bruise',
  'bleeding',
  'swelling',
  'pain',
  'laceration',
  'contusion',
  'fracture',
];

/**
 * Keywords that indicate less relevant sections
 */
const LESS_RELEVANT_KEYWORDS = [
  'medication',
  'medication given',
  'medications',
  'allergy',
  'allergies',
  'history',
  'past history',
  'diagnosis',
  'diagnoses',
  'routine',
  'admin',
  'administrative',
];

/**
 * Recognizes and segments a note into relevant sections
 * @param noteContent The full note text
 * @param options Configuration options
 * @returns Array of segments with their offsets
 */
export function recognizeSections(
  noteContent: string,
  options: {
    /** If true, filter out segments with less relevant keywords */
    filterLessRelevant?: boolean;
    /** If true, merge adjacent segments with same category */
    mergeAdjacent?: boolean;
    /** Minimum segment length (in characters) to keep */
    minSegmentLength?: number;
  } = {}
): NoteSegment[] {
  const {
    filterLessRelevant = true,
    mergeAdjacent = true,
    minSegmentLength = 10,
  } = options;

  const lines = noteContent.split('\n');
  const segments: NoteSegment[] = [];
  let currentOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStartOffset = currentOffset;
    const lineEndOffset = currentOffset + line.length;

    // Skip empty lines
    if (!line.trim()) {
      currentOffset += line.length + 1; // +1 for newline
      continue;
    }

    // Detect category from line content
    let category: string | null = null;
    const lineLower = line.toLowerCase();

    if (SECTION_PATTERNS.headings.test(line)) {
      category = 'heading';
    } else if (SECTION_PATTERNS.bulletLike.test(line) || SECTION_PATTERNS.numbered.test(line)) {
      category = 'list_item';
    } else if (SECTION_PATTERNS.colonSeparated.test(line)) {
      category = 'labeled';
    }

    // Check if segment is injury-relevant
    const isInjuryRelevant = INJURY_RELEVANT_KEYWORDS.some((keyword) =>
      lineLower.includes(keyword.toLowerCase())
    );

    const isLessRelevant = filterLessRelevant && LESS_RELEVANT_KEYWORDS.some((keyword) =>
      lineLower.includes(keyword.toLowerCase())
    );

    // Skip less relevant segments if filtering is enabled
    if (filterLessRelevant && isLessRelevant && !isInjuryRelevant) {
      currentOffset += line.length + 1;
      continue;
    }

    // Create segment
    if (line.trim().length >= minSegmentLength) {
      segments.push({
        text: line,
        startOffset: lineStartOffset,
        endOffset: lineEndOffset,
        category: category || (isInjuryRelevant ? 'relevant' : null),
      });
    }

    currentOffset += line.length + 1; // +1 for newline
  }

  // Merge adjacent segments with same category if enabled
  if (mergeAdjacent) {
    const merged: NoteSegment[] = [];
    let current: NoteSegment | null = null;

    for (const segment of segments) {
      if (
        current &&
        current.category === segment.category &&
        current.endOffset === segment.startOffset
      ) {
        // Merge with previous
        current = {
          text: current.text + '\n' + segment.text,
          startOffset: current.startOffset,
          endOffset: segment.endOffset,
          category: current.category,
        };
      } else {
        // Start new segment
        if (current) {
          merged.push(current);
        }
        current = segment;
      }
    }
    if (current) {
      merged.push(current);
    }
    return merged;
  }

  return segments;
}

/**
 * Extracts the most relevant sections from a note
 * Combines sections that are likely to contain injury information
 * @param noteContent The full note text
 * @returns Combined relevant text with offset mapping
 */
export function extractRelevantSections(noteContent: string): {
  relevantText: string;
  /** Mapping of character positions in relevantText to original note positions */
  offsetMap: Map<number, number>;
} {
  const segments = recognizeSections(noteContent, {
    filterLessRelevant: true,
    mergeAdjacent: true,
    minSegmentLength: 10,
  });

  // Filter to injury-relevant segments
  const relevantSegments = segments.filter(
    (seg) =>
      seg.category === 'relevant' ||
      seg.category === 'heading' ||
      seg.category === 'labeled' ||
      seg.text.toLowerCase().includes('injury') ||
      seg.text.toLowerCase().includes('skin') ||
      seg.text.toLowerCase().includes('assessment') ||
      INJURY_RELEVANT_KEYWORDS.some((keyword) =>
        seg.text.toLowerCase().includes(keyword.toLowerCase())
      )
  );

  // If we filtered too much, include at least 50% of segments
  if (relevantSegments.length < segments.length * 0.5 && segments.length > 0) {
    // Include first few segments plus injury-relevant ones
    const firstHalf = segments.slice(0, Math.ceil(segments.length / 2));
    const combined = new Set([...firstHalf, ...relevantSegments]);
    relevantSegments.splice(0, relevantSegments.length, ...combined);
  }

  // Build combined text and offset mapping
  let relevantText = '';
  const offsetMap = new Map<number, number>();

  for (const segment of relevantSegments) {
    const textStartInRelevant = relevantText.length;
    relevantText += segment.text + '\n';

    // Map each character position
    for (let i = 0; i < segment.text.length; i++) {
      offsetMap.set(textStartInRelevant + i, segment.startOffset + i);
    }
    // Map newline
    offsetMap.set(relevantText.length - 1, segment.endOffset);
  }

  return { relevantText: relevantText.trim(), offsetMap };
}
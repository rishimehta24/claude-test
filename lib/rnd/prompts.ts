/**
 * R&D Project: Two-Layer Injury Extraction Pipeline
 * 
 * Layer 1: LLM Evidence Extraction Prompts
 * These prompts extract structured evidence from unstructured notes without making final judgments.
 */

import { ALLOWED_INJURIES } from './schema';

export const LAYER1_SYSTEM_PROMPT = `You are a medical data extraction specialist. Your task is to extract structured evidence from unstructured fall incident notes. You do NOT make final judgments about injuries. You ONLY extract observable evidence.

PRIMARY DIRECTIVE: Extract all relevant evidence that could be used to determine injuries, including:
- Injury-related mentions (whether explicitly stated or implied)
- Negations and denials
- "No injury" statements
- Timing markers relative to the fall
- Body site mentions

Allowed_Injuries (for reference - only map if explicitly found):
${ALLOWED_INJURIES.map(inj => `      '${inj}'`).join(',\n')}

CRITICAL RULES FOR EVIDENCE EXTRACTION:
1. Extract evidence, not conclusions. If you see "shaking," extract it even if it's not an injury.
2. Quote exact text spans from the note. Use the exact wording.
3. Include all injury-related mentions, even if negated or unclear.
4. If an injury term is mentioned but not in Allowed_Injuries, set injury_candidate=null but keep the mention.
5. Mark negations explicitly - if you see "denies pain," that's a negation, not an injury.
6. Capture temporal markers: "post fall," "after fall," "yesterday," "found on floor," etc.
7. Identify body sites whenever mentioned: "right forearm," "left knee," etc.
8. Set certainty levels:
   - "explicit": injury term is directly stated (e.g., "bruise," "skin tear")
   - "implied": injury concept is present but term isn't used (e.g., "3cm tear" implies "skin tear")
   - "unclear": ambiguous whether it's an injury

OUTPUT FORMAT:
You MUST output ONLY a valid JSON object matching this exact schema:
{
  "injury_mentions": [
    {
      "text": "exact quoted substring from note",
      "injury_candidate": "abrasion" | null,
      "body_site": "right forearm" | null,
      "is_negated": true | false,
      "negation_text": "denies pain" | null,
      "temporal_relation_to_fall": "post_fall" | "during_fall" | "pre_fall" | "unknown",
      "certainty": "explicit" | "implied" | "unclear",
      "start_char": 123,
      "end_char": 145
    }
  ],
  "negations": [
    {
      "text": "exact negation phrase",
      "scope_hint": "substring it negates" | null,
      "start_char": 200,
      "end_char": 210
    }
  ],
  "no_injury_statements": [
    {
      "text": "exact phrase like 'no injuries noted'",
      "start_char": 150,
      "end_char": 165
    }
  ],
  "timing_markers": [
    {
      "text": "post fall",
      "start_char": 0,
      "end_char": 9
    }
  ],
  "body_sites": [
    {
      "text": "right forearm",
      "start_char": 50,
      "end_char": 63
    }
  ],
  "metadata": {
    "model_version": "claude-sonnet-4-5-20250929",
    "extraction_warnings": ["warning text if any"]
  }
}

EXAMPLES:

Example 1 (Multiple Injury Mentions):
Note: "New 3cm skin tear on right forearm, with minor bleeding. Area is red and swollen. Resident denies other pain."

Expected JSON Output:
{
  "injury_mentions": [
    {
      "text": "New 3cm skin tear on right forearm",
      "injury_candidate": "skin tear",
      "body_site": "right forearm",
      "is_negated": false,
      "negation_text": null,
      "temporal_relation_to_fall": "post_fall",
      "certainty": "explicit",
      "start_char": 0,
      "end_char": 35
    },
    {
      "text": "minor bleeding",
      "injury_candidate": "bleeding",
      "body_site": null,
      "is_negated": false,
      "negation_text": null,
      "temporal_relation_to_fall": "post_fall",
      "certainty": "explicit",
      "start_char": 40,
      "end_char": 54
    },
    {
      "text": "Area is red",
      "injury_candidate": "redness",
      "body_site": null,
      "is_negated": false,
      "negation_text": null,
      "temporal_relation_to_fall": "post_fall",
      "certainty": "explicit",
      "start_char": 56,
      "end_char": 67
    },
    {
      "text": "swollen",
      "injury_candidate": "swelling",
      "body_site": null,
      "is_negated": false,
      "negation_text": null,
      "temporal_relation_to_fall": "post_fall",
      "certainty": "explicit",
      "start_char": 73,
      "end_char": 80
    },
    {
      "text": "denies other pain",
      "injury_candidate": "pain",
      "body_site": null,
      "is_negated": true,
      "negation_text": "denies other pain",
      "temporal_relation_to_fall": "unknown",
      "certainty": "explicit",
      "start_char": 93,
      "end_char": 110
    }
  ],
  "negations": [
    {
      "text": "denies other pain",
      "scope_hint": "other pain",
      "start_char": 93,
      "end_char": 110
    }
  ],
  "no_injury_statements": [],
  "timing_markers": [],
  "body_sites": [
    {
      "text": "right forearm",
      "start_char": 25,
      "end_char": 38
    }
  ],
  "metadata": {
    "model_version": "claude-sonnet-4-5-20250929",
    "extraction_warnings": []
  }
}

Example 2 (No Injuries with Explicit Statement):
Note: "Unwitnessed fall. Assessed from head to toe, no cuts or bruises observed. Resident states they feel fine."

Expected JSON Output:
{
  "injury_mentions": [],
  "negations": [
    {
      "text": "no cuts or bruises observed",
      "scope_hint": "cuts or bruises",
      "start_char": 50,
      "end_char": 75
    }
  ],
  "no_injury_statements": [
    {
      "text": "no cuts or bruises observed",
      "start_char": 50,
      "end_char": 75
    }
  ],
  "timing_markers": [],
  "body_sites": [],
  "metadata": {
    "model_version": "claude-sonnet-4-5-20250929",
    "extraction_warnings": []
  }
}

Example 3 (General Symptoms - Extract But Don't Map):
Note: "Resident noted holding his shaking right hand, febrile T-37.8, denied complain of any discomfort."

Expected JSON Output:
{
  "injury_mentions": [
    {
      "text": "denied complain of any discomfort",
      "injury_candidate": null,
      "body_site": null,
      "is_negated": true,
      "negation_text": "denied complain of any discomfort",
      "temporal_relation_to_fall": "unknown",
      "certainty": "unclear",
      "start_char": 60,
      "end_char": 92
    }
  ],
  "negations": [
    {
      "text": "denied complain of any discomfort",
      "scope_hint": "discomfort",
      "start_char": 60,
      "end_char": 92
    }
  ],
  "no_injury_statements": [],
  "timing_markers": [],
  "body_sites": [
    {
      "text": "right hand",
      "start_char": 40,
      "end_char": 50
    }
  ],
  "metadata": {
    "model_version": "claude-sonnet-4-5-20250929",
    "extraction_warnings": ["Note contains general symptoms (shaking, febrile) that are not injuries"]
  }
}

TASK: Extract ALL evidence. Do NOT make final judgments. Output ONLY the JSON object, no preamble or explanations.`;

export const LAYER1_USER_PROMPT_TEMPLATE = (noteContent: string) => `Note:
${noteContent}

Extract evidence and output JSON:`;
/**
 * R&D Project: Two-Layer Injury Extraction Pipeline
 * 
 * Layer 2: Deterministic Evaluator
 * Converts Layer 1 evidence into final injuries using deterministic rules.
 */

import {
  Layer1Evidence,
  FinalInjuries,
  FinalInjury,
  AllowedInjury,
  ALLOWED_INJURIES,
  InjuryMention,
} from './schema';

export interface EvaluatorConfig {
  /** If true, exclude negated mentions even if explicit */
  excludeNegated: boolean;
  /** If true, return [] when global no_injury_statement exists unless explicit injury after it */
  respectNoInjuryStatements: boolean;
  /** If true, prefer explicit mentions over implied/unclear */
  preferExplicit: boolean;
  /** For "pain" - only accept if tied to body site or post-fall context */
  strictPainEvaluation: boolean;
  /** Require explicit matching to Allowed_Injuries list */
  requireExactMatch: boolean;
}

export const DEFAULT_CONFIG: EvaluatorConfig = {
  excludeNegated: true,
  respectNoInjuryStatements: true,
  preferExplicit: true,
  strictPainEvaluation: true,
  requireExactMatch: true,
};

/**
 * Main evaluator function that converts Layer 1 evidence to final injuries
 */
export function evaluateEvidence(
  evidence: Layer1Evidence,
  config: EvaluatorConfig = DEFAULT_CONFIG
): FinalInjuries {
  // Rule 1: Only consider injury_mentions where injury_candidate is in Allowed_Injuries
  let validMentions = evidence.injury_mentions.filter(
    (mention) => mention.injury_candidate !== null
  ) as Array<InjuryMention & { injury_candidate: AllowedInjury }>;

  // Rule 2: Exclude any mention with is_negated=true
  if (config.excludeNegated) {
    validMentions = validMentions.filter((mention) => !mention.is_negated);
  }

  // Rule 3: If a global no_injury_statement exists, return [] UNLESS there is at least
  // one explicit injury mention after the last no_injury_statement (use char offsets)
  if (config.respectNoInjuryStatements && evidence.no_injury_statements.length > 0) {
    const lastNoInjuryStatement = evidence.no_injury_statements.reduce((latest, current) =>
      current.end_char > latest.end_char ? current : latest
    );

    // Find explicit injuries after the last no_injury_statement
    const injuriesAfter = validMentions.filter(
      (mention) =>
        mention.start_char > lastNoInjuryStatement.end_char &&
        mention.certainty === 'explicit' &&
        !mention.is_negated
    );

    if (injuriesAfter.length === 0) {
      return [];
    }

    // Only keep injuries after the no_injury_statement
    validMentions = injuriesAfter;
  }

  // Rule 4: Prefer explicit mentions over implied/unclear
  if (config.preferExplicit) {
    const explicitMentions = validMentions.filter((m) => m.certainty === 'explicit');
    if (explicitMentions.length > 0) {
      validMentions = explicitMentions;
    }
  }

  // Rule 5: Special handling for "pain" - only accept if explicitly tied to body site or post-fall context
  if (config.strictPainEvaluation) {
    validMentions = validMentions.filter((mention) => {
      if (mention.injury_candidate === 'pain') {
        // Must have body site OR be post-fall/during-fall
        const hasBodySite = mention.body_site !== null && mention.body_site.trim() !== '';
        const isPostFall = mention.temporal_relation_to_fall === 'post_fall' ||
                          mention.temporal_relation_to_fall === 'during_fall';
        const isExplicit = mention.certainty === 'explicit';

        // Accept if: (has body site) OR (is post-fall AND explicit)
        return hasBodySite || (isPostFall && isExplicit);
      }
      return true;
    });
  }

  // Rule 6: Deduplicate by (matched_injury + normalized phrase) but keep the best phrase
  // (longer and more specific)
  const injuryMap = new Map<AllowedInjury, FinalInjury>();

  for (const mention of validMentions) {
    const key = mention.injury_candidate;
    const normalizedPhrase = normalizePhrase(mention.text);

    const existing = injuryMap.get(key);
    if (!existing) {
      injuryMap.set(key, {
        phrase: mention.text,
        matched_injury: key,
      });
    } else {
      // Keep the longer, more specific phrase
      const existingNormalized = normalizePhrase(existing.phrase);
      if (
        mention.text.length > existing.phrase.length ||
        (mention.body_site !== null && existing.phrase.toLowerCase().indexOf(mention.body_site.toLowerCase()) === -1)
      ) {
        injuryMap.set(key, {
          phrase: mention.text,
          matched_injury: key,
        });
      }
    }
  }

  // Rule 7: Produce stable sorting (by start_char, then by injury type)
  const finalInjuries: FinalInjury[] = Array.from(injuryMap.values());
  finalInjuries.sort((a, b) => {
    // Find the mention for each injury
    const mentionA = validMentions.find(
      (m) => m.injury_candidate === a.matched_injury && m.text === a.phrase
    );
    const mentionB = validMentions.find(
      (m) => m.injury_candidate === b.matched_injury && m.text === b.phrase
    );

    if (mentionA && mentionB) {
      // Sort by start_char first
      if (mentionA.start_char !== mentionB.start_char) {
        return mentionA.start_char - mentionB.start_char;
      }
    }

    // Then sort by injury type (alphabetical)
    return a.matched_injury.localeCompare(b.matched_injury);
  });

  return finalInjuries;
}

/**
 * Normalize a phrase for comparison (lowercase, trim whitespace)
 */
function normalizePhrase(phrase: string): string {
  return phrase.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Validate that a string is a valid AllowedInjury
 */
export function isValidAllowedInjury(value: string): value is AllowedInjury {
  return (ALLOWED_INJURIES as readonly string[]).includes(value);
}
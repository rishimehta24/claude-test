/**
 * R&D Project: Two-Layer Injury Extraction Pipeline
 * 
 * Main Pipeline Orchestrator
 * Combines Layer 1 (LLM evidence extraction) + Layer 2 (deterministic evaluator)
 */

import Anthropic from '@anthropic-ai/sdk';
import { Layer1Evidence, FinalInjuries, ALLOWED_INJURIES } from './schema';
import { LAYER1_SYSTEM_PROMPT, LAYER1_USER_PROMPT_TEMPLATE } from './prompts';
import { evaluateEvidence, DEFAULT_CONFIG, EvaluatorConfig } from './evaluator';
import { extractRelevantSections } from './section-recognizer';

export interface PipelineConfig {
  /** Anthropic API key */
  apiKey: string;
  /** Model to use for Layer 1 extraction */
  model: string;
  /** Temperature (should be 0 for determinism) */
  temperature?: number;
  /** Max tokens for Layer 1 extraction */
  maxTokens?: number;
  /** Whether to use section recognizer preprocessor */
  useSectionRecognizer?: boolean;
  /** Evaluator configuration */
  evaluatorConfig?: Partial<EvaluatorConfig>;
}

export interface PipelineResult {
  /** Final injuries in the existing format */
  finalInjuries: FinalInjuries;
  /** Layer 1 evidence (for auditing/explanation) */
  layer1Evidence: Layer1Evidence | null;
  /** Raw Layer 1 response from LLM */
  rawLayer1Response: string | null;
  /** Any errors that occurred */
  error: string | null;
  /** Whether section recognizer was used */
  usedSectionRecognizer: boolean;
  /** Original note content */
  originalNote: string;
  /** Preprocessed note content (if section recognizer was used) */
  preprocessedNote?: string;
}

/**
 * Main pipeline function
 */
export async function runPipeline(
  noteContent: string,
  config: PipelineConfig
): Promise<PipelineResult> {
  const anthropic = new Anthropic({ apiKey: config.apiKey });

  try {
    // Step 1: Optional preprocessing with section recognizer
    let noteToProcess = noteContent;
    let preprocessedNote: string | undefined;
    let usedSectionRecognizer = false;

    if (config.useSectionRecognizer) {
      const { relevantText } = extractRelevantSections(noteContent);
      noteToProcess = relevantText;
      preprocessedNote = relevantText;
      usedSectionRecognizer = true;
    }

    // Step 2: Layer 1 - LLM Evidence Extraction
    const layer1Prompt = LAYER1_USER_PROMPT_TEMPLATE(noteToProcess);

    const message = await anthropic.messages.create({
      model: config.model,
      max_tokens: config.maxTokens || 2000,
      temperature: config.temperature ?? 0,
      system: LAYER1_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: layer1Prompt,
        },
      ],
    });

    const content = message.content[0];
    const rawLayer1Response = content.type === 'text' ? content.text : '';

    // Parse Layer 1 JSON response
    let layer1Evidence: Layer1Evidence | null = null;
    try {
      // Extract JSON from response (in case there's extra text)
      const jsonMatch = rawLayer1Response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        layer1Evidence = JSON.parse(jsonMatch[0]) as Layer1Evidence;
      } else {
        throw new Error('No JSON object found in Layer 1 response');
      }
    } catch (parseError: any) {
      return {
        finalInjuries: [],
        layer1Evidence: null,
        rawLayer1Response,
        error: `Failed to parse Layer 1 response: ${parseError.message}`,
        usedSectionRecognizer,
        originalNote: noteContent,
        preprocessedNote,
      };
    }

    // Step 3: Layer 2 - Deterministic Evaluation
    const evaluatorConfig = { ...DEFAULT_CONFIG, ...(config.evaluatorConfig || {}) };
    const finalInjuries = evaluateEvidence(layer1Evidence, evaluatorConfig);

    return {
      finalInjuries,
      layer1Evidence,
      rawLayer1Response,
      error: null,
      usedSectionRecognizer,
      originalNote: noteContent,
      preprocessedNote,
    };
  } catch (error: any) {
    return {
      finalInjuries: [],
      layer1Evidence: null,
      rawLayer1Response: null,
      error: error.message || 'Unknown error',
      usedSectionRecognizer: config.useSectionRecognizer || false,
      originalNote: noteContent,
      preprocessedNote: undefined,
    };
  }
}

/**
 * Export allowed injuries for reference
 */
export { ALLOWED_INJURIES };
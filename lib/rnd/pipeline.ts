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
  /** API key for Anthropic */
  apiKey?: string;
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

async function callLayer1Anthropic(
  model: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  temperature: number
): Promise<string> {
  const anthropic = new Anthropic({ apiKey });
  const message = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userPrompt,
      },
    ],
  });
  const content = message.content[0];
  return content.type === 'text' ? content.text : '';
}


/**
 * Main pipeline function
 */
export async function runPipeline(
  noteContent: string,
  config: PipelineConfig
): Promise<PipelineResult> {
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
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) throw new Error('Anthropic API key not provided');
    
    const rawLayer1Response = await callLayer1Anthropic(
      config.model,
      apiKey,
      LAYER1_SYSTEM_PROMPT,
      layer1Prompt,
      config.maxTokens || 2000,
      config.temperature ?? 0
    );

    // Parse Layer 1 JSON response with robust parsing
    let layer1Evidence: Layer1Evidence | null = null;
    try {
      // Try multiple strategies to extract JSON object
      let jsonMatch: RegExpMatchArray | string | null = null;
      
      // Strategy 1: Try to find JSON code blocks
      const codeBlockMatch = rawLayer1Response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch && codeBlockMatch[1]) {
        jsonMatch = codeBlockMatch[1]; // Capture group is a string
      } else {
        // Strategy 2: Try to find JSON after common prefixes
        const afterPrefixMatch = rawLayer1Response.match(/(?:Output|Response|JSON):\s*(\{[\s\S]*?\})/i);
        if (afterPrefixMatch && afterPrefixMatch[1]) {
          jsonMatch = afterPrefixMatch[1]; // Capture group is a string
        } else {
          // Strategy 3: Try to find a JSON object (non-greedy to avoid capturing too much)
          const objectMatch = rawLayer1Response.match(/\{[\s\S]*?\}/);
          if (objectMatch) {
            // For nested objects, we need to balance braces properly
            // Try to find the largest valid JSON object
            let braceCount = 0;
            let startIdx = rawLayer1Response.indexOf('{');
            if (startIdx !== -1) {
              for (let i = startIdx; i < rawLayer1Response.length; i++) {
                if (rawLayer1Response[i] === '{') braceCount++;
                if (rawLayer1Response[i] === '}') braceCount--;
                if (braceCount === 0 && i > startIdx) {
                  jsonMatch = rawLayer1Response.substring(startIdx, i + 1);
                  break;
                }
              }
            }
          }
        }
      }
      
      if (jsonMatch) {
        const jsonStr = typeof jsonMatch === 'string' ? jsonMatch : jsonMatch[0];
        // Clean up common issues: trailing commas, extra whitespace
        const cleanedJson = jsonStr
          .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
          .trim();
        layer1Evidence = JSON.parse(cleanedJson) as Layer1Evidence;
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
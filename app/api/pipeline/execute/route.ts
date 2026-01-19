/**
 * API Route: Unified Pipeline Execution
 * Executes a modular pipeline with blocks that can be arranged in any order
 */

import { NextRequest, NextResponse } from 'next/server';
import { runPipeline, Layer1Evidence } from '@/lib/rnd/pipeline';
import { evaluateEvidence } from '@/lib/rnd/evaluator';
import { findSimilarSentences, validateSemantically } from '@/lib/semantic-validator';
import Anthropic from '@anthropic-ai/sdk';
import { ALL_MODELS, ALLOWED_INJURIES } from '@/lib/rnd/schema';
import { LAYER1_SYSTEM_PROMPT, LAYER1_USER_PROMPT_TEMPLATE } from '@/lib/rnd/prompts';
import { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } from '@/lib/constants';

export const runtime = 'nodejs';

// Helper function to call Claude LLM
async function callLLM(
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  maxTokens: number,
  apiKey: string
): Promise<{ response: string; usage: { input_tokens: number; output_tokens: number } }> {
  const anthropic = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY || '' });
  const message = await anthropic.messages.create({
    model: modelId,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const content = message.content[0];
  return {
    response: content.type === 'text' ? content.text : '',
    usage: {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
    },
  };
}

export interface PipelineBlock {
  id: string;
  type: 'input' | 'semantic_validation' | 'llm_extraction' | 'layer2_evaluator' | 'llm_refinement' | 'llm_evaluation' | 'double_layer_llm';
  config?: {
    modelId?: string;
    modelId2?: string; // For double_layer_llm - second model
    temperature?: number;
    temperature2?: number; // For double_layer_llm - second model temperature
    maxTokens?: number;
    maxTokens2?: number; // For double_layer_llm - second model max tokens
    thresholds?: {
      strong?: number;
      medium?: number;
      min?: number;
    };
  };
}

export interface BlockResult {
  blockId: string;
  blockType: string;
  input: any;
  output: any;
  metadata: {
    tokens?: { input: number; output: number };
    cost?: number;
    processingTime?: number;
  };
  error?: string;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-5-20251101': { input: 5.0, output: 25.0 },
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
  'claude-3-haiku-20240307': { input: 0.8, output: 4.0 },
};

// Export executeBlock for use in batch evaluation
export async function executeBlock(
  block: PipelineBlock,
  input: any,
  apiKey: string
): Promise<BlockResult> {
  const startTime = Date.now();
  const blockResult: BlockResult = {
    blockId: block.id,
    blockType: block.type,
    input,
    output: null,
    metadata: {},
  };

  try {
    switch (block.type) {
      case 'input':
        // Input block just passes through the note content
        blockResult.output = { noteContent: input.noteContent || input };
        blockResult.metadata = { tokens: { input: 0, output: 0 }, cost: 0 };
        break;

      case 'semantic_validation':
        // Semantic validation: Find similar sentences
        const textForSemantic = input.noteContent || input;
        const similarSentences = await findSimilarSentences(textForSemantic, 100);
        const thresholds = block.config?.thresholds || { strong: 0.7, medium: 0.5, min: 0.3 };
        
        const strongMatches = similarSentences.filter(s => s.similarity >= thresholds.strong!);
        const mediumMatches = similarSentences.filter(
          s => s.similarity >= thresholds.medium! && s.similarity < thresholds.strong!
        );
        const weakMatches = similarSentences.filter(
          s => s.similarity >= thresholds.min! && s.similarity < thresholds.medium!
        );

        blockResult.output = {
          matches: {
            strong: strongMatches,
            medium: mediumMatches,
            weak: weakMatches,
            all: similarSentences,
          },
          noteContent: textForSemantic,
        };
        blockResult.metadata = { tokens: { input: 0, output: 0 }, cost: 0 };
        break;

      case 'llm_extraction':
        // LLM extraction (Layer 1 style)
        const noteForExtraction = input.noteContent || input;
        const modelId = block.config?.modelId || 'claude-sonnet-4-5-20250929';
        const temperature = block.config?.temperature ?? 0;
        const maxTokens = block.config?.maxTokens || 2000;

        const layer1Prompt = LAYER1_USER_PROMPT_TEMPLATE(noteForExtraction);
        const llmResult = await callLLM(
          modelId,
          LAYER1_SYSTEM_PROMPT,
          layer1Prompt,
          temperature,
          maxTokens,
          apiKey
        );

        const rawResponse = llmResult.response;
        const outputTokens = llmResult.usage.output_tokens;
        const actualInputTokens = llmResult.usage.input_tokens;

        // Parse JSON response
        let layer1Evidence: Layer1Evidence | null = null;
        try {
          const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const jsonStr = typeof jsonMatch === 'string' ? jsonMatch : jsonMatch[0];
            const cleanedJson = jsonStr.replace(/,(\s*[}\]])/g, '$1').trim();
            layer1Evidence = JSON.parse(cleanedJson) as Layer1Evidence;
          }
        } catch (parseError) {
          throw new Error(`Failed to parse Layer 1 response: ${parseError}`);
        }

        const pricing = MODEL_PRICING[modelId] || { input: 3.0, output: 15.0 };
        const cost = (actualInputTokens / 1_000_000) * pricing.input + 
                    (outputTokens / 1_000_000) * pricing.output;

        blockResult.output = {
          layer1Evidence,
          rawResponse,
          noteContent: noteForExtraction,
        };
        blockResult.metadata = {
          tokens: { input: actualInputTokens, output: outputTokens },
          cost,
        };
        break;

      case 'layer2_evaluator':
        // Layer 2: Deterministic evaluation
        // NOTE: This block requires Layer 1 evidence (structured JSON from LLM Extraction)
        // It CANNOT work standalone with raw note content - it needs the structured evidence format
        const evidenceForLayer2 = input.layer1Evidence;
        
        if (!evidenceForLayer2) {
          // Check if we have raw note content - if so, suggest using a different Layer 2 block
          const noteContent = input.noteContent || (typeof input === 'string' ? input : null);
          if (noteContent) {
            throw new Error('Layer 2 Evaluator requires Layer 1 evidence (from LLM Extraction block). For standalone use with raw note content, use "LLM Evaluation (Direct)" or "Double Layer LLM Analysis" instead.');
          }
          throw new Error('Layer 1 evidence required for Layer 2 evaluation. Use LLM Extraction first.');
        }

        const finalInjuries = evaluateEvidence(evidenceForLayer2);
        blockResult.output = {
          finalInjuries,
          layer1Evidence: evidenceForLayer2,
          noteContent: input.noteContent || input,
        };
        blockResult.metadata = { tokens: { input: 0, output: 0 }, cost: 0 };
        break;

      case 'llm_refinement':
        // LLM refinement (like semantic + LLM hybrid)
        // Can accept semantic matches OR raw note content (works standalone but less effective)
        const semanticMatches = input.matches;
        const noteForRefinement = input.noteContent || (typeof input === 'string' ? input : input.noteContent) || '';
        const refineModelId = block.config?.modelId || 'claude-haiku-4-5-20251001';

        if (!semanticMatches) {
          throw new Error('Semantic matches required for LLM refinement. Use Semantic Validation first.');
        }

        // Format matches table
        const allMatches = semanticMatches.all || [];
        let matchesTable = 'SEMANTIC VALIDATION RESULTS:\n';
        matchesTable += '┌─────────────────────────────────────────────────────────┬────────────────────┬────────────┐\n';
        matchesTable += '│ Text from Note                                        │ Matched Injury     │ Similarity │\n';
        matchesTable += '├─────────────────────────────────────────────────────────┼────────────────────┼────────────┤\n';
        for (const match of allMatches) {
          const text = (match.sentence || '').substring(0, 45).padEnd(45);
          const injury = (match.matchedInjury || '').padEnd(18);
          const similarity = `${((match.similarity || 0) * 100).toFixed(1)}%`.padEnd(10);
          matchesTable += `│ ${text} │ ${injury} │ ${similarity} │\n`;
        }
        matchesTable += '└─────────────────────────────────────────────────────────┴────────────────────┴────────────┘\n';

        const systemPrompt = `You are a medical data analyst. Review semantic validation matches and determine actual injuries. Return ONLY a JSON array: [{phrase: "...", matched_injury: "..."}] or [] if none.`;
        const userPrompt = `ORIGINAL NOTE:\n${noteForRefinement}\n\n${matchesTable}\n\nReturn JSON array of actual injuries.`;

        const refineLLMResult = await callLLM(
          refineModelId,
          systemPrompt,
          userPrompt,
          0,
          2000,
          apiKey
        );

        const refineResponse = refineLLMResult.response;
        const refineOutputTokens = refineLLMResult.usage.output_tokens;
        const refineActualInputTokens = refineLLMResult.usage.input_tokens;

        let finalInjuriesRefined: Array<{ phrase: string; matched_injury: string }> = [];
        try {
          const jsonMatch = refineResponse.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            finalInjuriesRefined = JSON.parse(jsonMatch[0]);
          }
        } catch (e) {
          // Continue with empty array if parse fails
        }

        const refinePricing = MODEL_PRICING[refineModelId] || { input: 1.0, output: 5.0 };
        const refineCost = (refineActualInputTokens / 1_000_000) * refinePricing.input + 
                          (refineOutputTokens / 1_000_000) * refinePricing.output;

        blockResult.output = {
          finalInjuries: finalInjuriesRefined,
          llmResponse: refineResponse,
          semanticMatches,
          noteContent: noteForRefinement,
        };
        blockResult.metadata = {
          tokens: { input: refineActualInputTokens, output: refineOutputTokens },
          cost: refineCost,
        };
        break;

      case 'llm_evaluation':
        // LLM Evaluation: Direct evaluation using original SYSTEM_PROMPT approach
        // Works standalone - accepts raw note content directly
        const noteForEval = input.noteContent || (typeof input === 'string' ? input : '');
        const evalModelId = block.config?.modelId || 'claude-sonnet-4-5-20250929';
        const evalTemperature = block.config?.temperature ?? 0.1;
        const evalMaxTokens = block.config?.maxTokens || 500;

        const evalUserPrompt = USER_PROMPT_TEMPLATE(noteForEval);
        const evalLLMResult = await callLLM(
          evalModelId,
          SYSTEM_PROMPT,
          evalUserPrompt,
          evalTemperature,
          evalMaxTokens,
          apiKey
        );

        const evalResponse = evalLLMResult.response;
        const evalOutputTokens = evalLLMResult.usage.output_tokens;
        const evalActualInputTokens = evalLLMResult.usage.input_tokens;

        // Parse JSON response (should be array of injuries)
        let evaluatedInjuries: Array<{ phrase: string; matched_injury: string }> = [];
        try {
          const jsonMatch = evalResponse.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            evaluatedInjuries = JSON.parse(jsonMatch[0]);
          }
        } catch (e) {
          // Continue with empty array if parse fails
        }

        const evalPricing = MODEL_PRICING[evalModelId] || { input: 3.0, output: 15.0 };
        const evalCost = (evalActualInputTokens / 1_000_000) * evalPricing.input + 
                        (evalOutputTokens / 1_000_000) * evalPricing.output;

        blockResult.output = {
          finalInjuries: evaluatedInjuries,
          llmResponse: evalResponse,
          noteContent: noteForEval,
        };
        blockResult.metadata = {
          tokens: { input: evalActualInputTokens, output: evalOutputTokens },
          cost: evalCost,
        };
        break;

      case 'double_layer_llm':
        // Double Layer LLM: Two LLMs analyze same input, combine via Jaccard similarity
        const noteForDoubleLayer = input.noteContent || (typeof input === 'string' ? input : '');
        const model1Id = block.config?.modelId || 'claude-sonnet-4-5-20250929';
        const model2Id = block.config?.modelId2 || 'claude-haiku-4-5-20251001';
        const temp1 = block.config?.temperature ?? 0.1;
        const temp2 = block.config?.temperature2 ?? 0.1;
        const maxTokens1 = block.config?.maxTokens || 500;
        const maxTokens2 = block.config?.maxTokens2 || 500;

        // Run both LLMs in parallel (can be different providers)
        const userPrompt1 = USER_PROMPT_TEMPLATE(noteForDoubleLayer);
        const userPrompt2 = USER_PROMPT_TEMPLATE(noteForDoubleLayer);

        const [llmResult1, llmResult2] = await Promise.all([
          callLLM(
            model1Id,
            SYSTEM_PROMPT,
            userPrompt1,
            temp1,
            maxTokens1,
            apiKey
          ),
          callLLM(
            model2Id,
            SYSTEM_PROMPT,
            userPrompt2,
            temp2,
            maxTokens2,
            apiKey
          ),
        ]);

        const response1 = llmResult1.response;
        const response2 = llmResult2.response;

        let injuries1: Array<{ phrase: string; matched_injury: string }> = [];
        let injuries2: Array<{ phrase: string; matched_injury: string }> = [];

        try {
          const jsonMatch1 = response1.match(/\[[\s\S]*\]/);
          if (jsonMatch1) {
            injuries1 = JSON.parse(jsonMatch1[0]);
          }
        } catch (e) {
          console.error('Failed to parse LLM 1 response:', e);
        }

        try {
          const jsonMatch2 = response2.match(/\[[\s\S]*\]/);
          if (jsonMatch2) {
            injuries2 = JSON.parse(jsonMatch2[0]);
          }
        } catch (e) {
          console.error('Failed to parse LLM 2 response:', e);
        }

        // Calculate Jaccard similarity and combine results
        const set1 = new Set(injuries1.map(i => i.matched_injury));
        const set2 = new Set(injuries2.map(i => i.matched_injury));

        // Intersection (injuries both LLMs agree on)
        const intersection = new Set([...set1].filter(x => set2.has(x)));
        
        // Union (all injuries from both LLMs)
        const union = new Set([...set1, ...set2]);

        // Jaccard similarity = |intersection| / |union|
        const jaccardSimilarity = union.size === 0 ? 0 : intersection.size / union.size;

        // Final output: Use intersection (injuries both LLMs agree on)
        // Create a map to preserve phrases (prefer from LLM1, fallback to LLM2)
        const injuryMap = new Map<string, { phrase: string; matched_injury: string }>();
        
        // Add injuries from intersection, prioritizing LLM1
        for (const injury of intersection) {
          const fromLLM1 = injuries1.find(i => i.matched_injury === injury);
          const fromLLM2 = injuries2.find(i => i.matched_injury === injury);
          injuryMap.set(injury, fromLLM1 || fromLLM2!);
        }

        const finalCombinedInjuries = Array.from(injuryMap.values());

        // Calculate costs
        const pricing1 = MODEL_PRICING[model1Id] || { input: 3.0, output: 15.0 };
        const pricing2 = MODEL_PRICING[model2Id] || { input: 1.0, output: 5.0 };
        const cost1 = (llmResult1.usage.input_tokens / 1_000_000) * pricing1.input + 
                      (llmResult1.usage.output_tokens / 1_000_000) * pricing1.output;
        const cost2 = (llmResult2.usage.input_tokens / 1_000_000) * pricing2.input + 
                      (llmResult2.usage.output_tokens / 1_000_000) * pricing2.output;
        const totalCost = cost1 + cost2;

        blockResult.output = {
          finalInjuries: finalCombinedInjuries,
          llm1Response: response1,
          llm2Response: response2,
          llm1Injuries: injuries1,
          llm2Injuries: injuries2,
          jaccardSimilarity,
          intersection: Array.from(intersection),
          union: Array.from(union),
          noteContent: noteForDoubleLayer,
        };
        blockResult.metadata = {
          tokens: { 
            input: llmResult1.usage.input_tokens + llmResult2.usage.input_tokens,
            output: llmResult1.usage.output_tokens + llmResult2.usage.output_tokens
          },
          cost: totalCost,
        };
        break;

      default:
        throw new Error(`Unknown block type: ${block.type}`);
    }

    blockResult.metadata.processingTime = Date.now() - startTime;
    return blockResult;
  } catch (error: any) {
    blockResult.error = error.message;
    blockResult.metadata.processingTime = Date.now() - startTime;
    return blockResult;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { blocks, inputNote, apiKey } = body;

    if (!blocks || !Array.isArray(blocks) || blocks.length === 0) {
      return NextResponse.json(
        { error: 'blocks array is required' },
        { status: 400 }
      );
    }

    if (!inputNote) {
      return NextResponse.json(
        { error: 'inputNote is required' },
        { status: 400 }
      );
    }

    const apiKeyToUse = apiKey || process.env.ANTHROPIC_API_KEY || '';

    // Execute blocks sequentially
    let currentData: any = { noteContent: inputNote };
    const results: BlockResult[] = [];

    for (const block of blocks) {
      const result = await executeBlock(block, currentData, apiKeyToUse);
      results.push(result);

      if (result.error) {
        // Stop execution on error, but include the error in results
        break;
      }

      // Pass output to next block
      currentData = result.output;
    }

    const totalCost = results.reduce((sum, r) => sum + (r.metadata.cost || 0), 0);
    const totalInputTokens = results.reduce((sum, r) => sum + (r.metadata.tokens?.input || 0), 0);
    const totalOutputTokens = results.reduce((sum, r) => sum + (r.metadata.tokens?.output || 0), 0);

    return NextResponse.json({
      results,
      summary: {
        totalBlocks: blocks.length,
        executedBlocks: results.length,
        totalCost,
        totalInputTokens,
        totalOutputTokens,
        finalOutput: currentData,
      },
    });
  } catch (error: any) {
    console.error('Pipeline execution error:', error);
    return NextResponse.json(
      {
        error: 'Failed to execute pipeline',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

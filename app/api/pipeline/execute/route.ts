/**
 * API Route: Unified Pipeline Execution
 * Executes a modular pipeline with blocks that can be arranged in any order
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractRelevantSections } from '@/lib/rnd/section-recognizer';
import { runPipeline, Layer1Evidence } from '@/lib/rnd/pipeline';
import { evaluateEvidence } from '@/lib/rnd/evaluator';
import { findSimilarSentences, validateSemantically } from '@/lib/semantic-validator';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ALL_MODELS, ALLOWED_INJURIES } from '@/lib/rnd/schema';
import { LAYER1_SYSTEM_PROMPT, LAYER1_USER_PROMPT_TEMPLATE } from '@/lib/rnd/prompts';

export const runtime = 'nodejs';

interface PipelineBlock {
  id: string;
  type: 'input' | 'section_recognizer' | 'semantic_validation' | 'llm_extraction' | 'layer2_evaluator' | 'llm_refinement';
  config?: {
    modelId?: string;
    temperature?: number;
    maxTokens?: number;
    thresholds?: {
      strong?: number;
      medium?: number;
      min?: number;
    };
  };
}

interface BlockResult {
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
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-3.5-turbo': { input: 1.5, output: 3.0 },
  'gemini-1.5-pro-latest': { input: 2.0, output: 12.0 },
  'gemini-1.5-flash-latest': { input: 0.1, output: 0.4 },
};

async function executeBlock(
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

      case 'section_recognizer':
        // Pre-processor: Extract relevant sections
        const noteContent = input.noteContent || input;
        const { relevantText } = extractRelevantSections(noteContent);
        blockResult.output = { noteContent: relevantText, originalNote: noteContent };
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

        const anthropic = new Anthropic({ apiKey });
        const layer1Prompt = LAYER1_USER_PROMPT_TEMPLATE(noteForExtraction);
        
        const inputTokens = estimateTokens(LAYER1_SYSTEM_PROMPT + layer1Prompt);
        
        const message = await anthropic.messages.create({
          model: modelId,
          max_tokens: maxTokens,
          temperature,
          system: LAYER1_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: layer1Prompt }],
        });

        const content = message.content[0];
        const rawResponse = content.type === 'text' ? content.text : '';
        const outputTokens = message.usage.output_tokens;
        const actualInputTokens = message.usage.input_tokens;

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
        const evidence = input.layer1Evidence;
        if (!evidence) {
          throw new Error('Layer 1 evidence required for Layer 2 evaluation');
        }

        const finalInjuries = evaluateEvidence(evidence);
        blockResult.output = {
          finalInjuries,
          layer1Evidence: evidence,
          noteContent: input.noteContent || input,
        };
        blockResult.metadata = { tokens: { input: 0, output: 0 }, cost: 0 };
        break;

      case 'llm_refinement':
        // LLM refinement (like semantic + LLM hybrid)
        const semanticMatches = input.matches;
        const noteForRefinement = input.noteContent || input;
        const refineModelId = block.config?.modelId || 'claude-haiku-4-5-20251001';

        if (!semanticMatches) {
          throw new Error('Semantic matches required for LLM refinement');
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

        const anthropicRefine = new Anthropic({ apiKey });
        const refineInputTokens = estimateTokens(systemPrompt + userPrompt);
        
        const refineMessage = await anthropicRefine.messages.create({
          model: refineModelId,
          max_tokens: 2000,
          temperature: 0,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        });

        const refineContent = refineMessage.content[0];
        const refineResponse = refineContent.type === 'text' ? refineContent.text : '';
        const refineOutputTokens = refineMessage.usage.output_tokens;
        const refineActualInputTokens = refineMessage.usage.input_tokens;

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

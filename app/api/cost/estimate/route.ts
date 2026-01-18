/**
 * API Route: Cost Estimation
 * Measures token usage for different pipeline steps
 */

import { NextRequest, NextResponse } from 'next/server';
import { findSimilarSentences } from '@/lib/semantic-validator';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ALL_MODELS } from '@/lib/constants';

export const runtime = 'nodejs';

interface TokenEstimate {
  inputTokens: number;
  outputTokens: number;
  processedText: string;
  error?: string;
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

function estimateTokens(text: string): number {
  // Rough estimation: ~4 characters per token (conservative estimate)
  return Math.ceil(text.length / 4);
}

async function measureLLMTokens(
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
  processedText: string
): Promise<TokenEstimate> {
  try {
    const model = ALL_MODELS.find(m => m.id === modelId);
    if (!model) {
      return { inputTokens: 0, outputTokens: 0, processedText, error: 'Model not found' };
    }

    // Estimate input tokens (system + user prompt)
    const inputText = `${systemPrompt}\n\n${userPrompt}`;
    const inputTokens = estimateTokens(inputText);
    
    // For output, we'll estimate based on a typical response
    // In a real scenario, you'd want to actually call the API and measure
    // But for estimation, we can use a conservative estimate
    const estimatedOutputTokens = 200; // Typical injury extraction response

    return {
      inputTokens,
      outputTokens: estimatedOutputTokens,
      processedText,
    };
  } catch (error: any) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      processedText,
      error: error.message,
    };
  }
}

async function measureSemanticValidation(text: string): Promise<TokenEstimate> {
  // Semantic validation is free (local), returns 0 tokens for API cost
  // But we track the processed text to see what gets passed to next step
  // In practice, semantic validation could filter/reduce the text for the next step
  try {
    const similarSentences = await findSimilarSentences(text, 100);
    
    // If we wanted to optimize, we could return only the matching sentences
    // For now, we'll keep the original text but note that in a real pipeline,
    // you might pass only the filtered sentences to reduce token count for next step
    
    return {
      inputTokens: 0, // Free - no API cost
      outputTokens: 0, // Free - no API cost
      processedText: text, // Could be filtered version in production
    };
  } catch (error: any) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      processedText: text,
      error: error.message,
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { steps, inputText, systemPrompt } = body;

    if (!inputText || !steps || !Array.isArray(steps)) {
      return NextResponse.json(
        { error: 'inputText and steps array are required' },
        { status: 400 }
      );
    }

    let currentText = inputText;
    const stepResults: Array<{
      step: string;
      type: 'semantic' | 'llm';
      inputTokens: number;
      outputTokens: number;
      cost: number;
      processedText: string;
      error?: string;
    }> = [];

    for (const step of steps) {
      if (step.type === 'semantic') {
        const result = await measureSemanticValidation(currentText);
        stepResults.push({
          step: 'Semantic Validation',
          type: 'semantic',
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          cost: 0, // Free
          processedText: result.processedText,
          error: result.error,
        });
        currentText = result.processedText;
      } else if (step.type === 'llm') {
        // Create a user prompt with the current processed text
        const userPrompt = systemPrompt 
          ? `${systemPrompt}\n\nNote:\n${currentText}`
          : `Note:\n${currentText}`;

        const result = await measureLLMTokens(
          step.modelId,
          systemPrompt || '',
          userPrompt,
          currentText
        );

        const pricing = MODEL_PRICING[step.modelId] || { input: 3.0, output: 15.0 };
        const cost = (result.inputTokens / 1_000_000) * pricing.input + 
                    (result.outputTokens / 1_000_000) * pricing.output;

        stepResults.push({
          step: step.modelId,
          type: 'llm',
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          cost,
          processedText: result.processedText,
          error: result.error,
        });

        // For next step, use the output (simulated)
        currentText = result.processedText; // In reality, would be LLM response
      }
    }

    const totalCost = stepResults.reduce((sum, r) => sum + r.cost, 0);
    const totalInputTokens = stepResults.reduce((sum, r) => sum + r.inputTokens, 0);
    const totalOutputTokens = stepResults.reduce((sum, r) => sum + r.outputTokens, 0);

    return NextResponse.json({
      steps: stepResults,
      totals: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cost: totalCost,
      },
    });
  } catch (error: any) {
    console.error('Cost estimation error:', error);
    return NextResponse.json(
      {
        error: 'Failed to estimate cost',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

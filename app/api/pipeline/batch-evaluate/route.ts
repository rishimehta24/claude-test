/**
 * API Route: Batch Pipeline Evaluation
 * Runs multiple pipeline configs against multiple notes and generates a comparison report
 */

import { NextRequest, NextResponse } from 'next/server';
import { executeBlock, type PipelineBlock, type BlockResult } from '../execute/route';

export const runtime = 'nodejs';

interface PipelineConfig {
  id: string;
  name: string;
  blocks: PipelineBlock[];
}

interface EvaluationResult {
  configId: string;
  configName: string;
  noteIndex: number;
  noteContent: string;
  success: boolean;
  finalInjuries: Array<{ phrase: string; matched_injury: string }> | null;
  cost: number;
  processingTime: number;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { configs, notes, apiKey } = body;

    if (!configs || !Array.isArray(configs) || configs.length === 0) {
      return NextResponse.json(
        { error: 'configs array is required' },
        { status: 400 }
      );
    }

    if (!notes || !Array.isArray(notes) || notes.length === 0) {
      return NextResponse.json(
        { error: 'notes array is required' },
        { status: 400 }
      );
    }

    const apiKeyToUse = apiKey || process.env.ANTHROPIC_API_KEY || '';
    const results: EvaluationResult[] = [];

    // Evaluate each config against each note
    for (const config of configs) {
      for (let noteIndex = 0; noteIndex < notes.length; noteIndex++) {
        const noteContent = notes[noteIndex];
        const startTime = Date.now();

        try {
          // Execute pipeline blocks sequentially
          let currentData: any = { noteContent };
          let totalCost = 0;

          for (const block of config.blocks) {
            const blockResult = await executeBlock(block, currentData, apiKeyToUse);
            totalCost += blockResult.metadata.cost || 0;

            if (blockResult.error) {
              throw new Error(blockResult.error);
            }

            currentData = blockResult.output;
          }

          // Extract final injuries from output (could be in different places depending on last block)
          let finalInjuries: Array<{ phrase: string; matched_injury: string }> | null = null;
          if (currentData.finalInjuries) {
            finalInjuries = currentData.finalInjuries;
          } else if (currentData.layer1Evidence) {
            // If last block was Layer 1, no final injuries yet
            finalInjuries = [];
          }

          results.push({
            configId: config.id,
            configName: config.name,
            noteIndex,
            noteContent: noteContent.substring(0, 200), // Truncate for report
            success: true,
            finalInjuries,
            cost: totalCost,
            processingTime: Date.now() - startTime,
          });
        } catch (error: any) {
          results.push({
            configId: config.id,
            configName: config.name,
            noteIndex,
            noteContent: noteContent.substring(0, 200),
            success: false,
            finalInjuries: null,
            cost: 0,
            processingTime: Date.now() - startTime,
            error: error.message,
          });
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Generate summary statistics
    const summary = {
      totalConfigs: configs.length,
      totalNotes: notes.length,
      totalEvaluations: results.length,
      successfulEvaluations: results.filter(r => r.success).length,
      failedEvaluations: results.filter(r => !r.success).length,
      totalCost: results.reduce((sum, r) => sum + r.cost, 0),
      averageCost: results.filter(r => r.success).reduce((sum, r) => sum + r.cost, 0) / 
                   (results.filter(r => r.success).length || 1),
      averageProcessingTime: results.reduce((sum, r) => sum + r.processingTime, 0) / results.length,
    };

    // Group results by config for easier analysis
    const resultsByConfig = configs.map(config => ({
      configId: config.id,
      configName: config.name,
      results: results.filter(r => r.configId === config.id),
    }));

    return NextResponse.json({
      summary,
      results,
      resultsByConfig,
    });
  } catch (error: any) {
    console.error('Batch evaluation error:', error);
    return NextResponse.json(
      {
        error: 'Failed to run batch evaluation',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

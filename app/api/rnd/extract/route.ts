/**
 * R&D Project: Two-Layer Injury Extraction Pipeline
 * 
 * API Route for R&D Pipeline Testing
 * POST /api/rnd/extract
 */

import { NextRequest, NextResponse } from 'next/server';
import { runPipeline, PipelineConfig } from '@/lib/rnd/pipeline';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { noteContent, config } = body;

    if (!noteContent) {
      return NextResponse.json(
        { error: 'Note content is required' },
        { status: 400 }
      );
    }

    const pipelineConfig: PipelineConfig = {
      apiKeys: {
        anthropic: process.env.ANTHROPIC_API_KEY || '',
        openai: process.env.OPENAI_API_KEY || '',
        google: process.env.GOOGLE_API_KEY || '',
      },
      model: config?.model || 'claude-sonnet-4-5-20250929',
      temperature: config?.temperature ?? 0,
      maxTokens: config?.maxTokens || 2000,
      useSectionRecognizer: config?.useSectionRecognizer ?? false,
      evaluatorConfig: config?.evaluatorConfig || {},
    };

    const result = await runPipeline(noteContent, pipelineConfig);

    return NextResponse.json({
      success: !result.error,
      result,
    });
  } catch (error: any) {
    console.error('R&D Pipeline API Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error', success: false },
      { status: 500 }
    );
  }
}
/**
 * API Route: Semantic Validation using Sentence Transformers
 * Validates injury mentions using semantic similarity
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  validateSemantically,
  findSimilarSentences,
  SemanticValidatorConfig,
} from '@/lib/semantic-validator';
import { Layer1Evidence } from '@/lib/rnd/schema';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      layer1Evidence,
      noteContent,
      config,
      mode = 'validate', // 'validate' or 'find_sentences'
    }: {
      layer1Evidence?: Layer1Evidence;
      noteContent?: string;
      config?: SemanticValidatorConfig;
      mode?: 'validate' | 'find_sentences';
    } = body;

    if (mode === 'find_sentences') {
      // Find similar sentences in the note
      if (!noteContent) {
        return NextResponse.json(
          { error: 'noteContent is required for find_sentences mode' },
          { status: 400 }
        );
      }

      const topK = config?.strongThreshold || 10;
      const similarSentences = await findSimilarSentences(noteContent, topK);

      return NextResponse.json({
        mode: 'find_sentences',
        similarSentences,
      });
    } else {
      // Validate injury mentions from Layer 1
      if (!layer1Evidence || !layer1Evidence.injury_mentions) {
        return NextResponse.json(
          { error: 'layer1Evidence with injury_mentions is required for validate mode' },
          { status: 400 }
        );
      }

      const injuryMentions = layer1Evidence.injury_mentions.map((m) => ({
        text: m.text,
        injury_candidate: m.injury_candidate,
      }));

      const result = await validateSemantically(injuryMentions, config);

      return NextResponse.json({
        mode: 'validate',
        ...result,
      });
    }
  } catch (error: any) {
    console.error('Semantic validation error:', error);
    return NextResponse.json(
      {
        error: 'Failed to perform semantic validation',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
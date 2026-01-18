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
      mode = 'validate', // 'validate', 'find_sentences', or 'direct'
    }: {
      layer1Evidence?: Layer1Evidence;
      noteContent?: string;
      config?: SemanticValidatorConfig;
      mode?: 'validate' | 'find_sentences' | 'direct';
    } = body;

    if (mode === 'direct') {
      // Direct semantic validation - no Layer 1, works directly on note content
      if (!noteContent) {
        return NextResponse.json(
          { error: 'noteContent is required for direct mode' },
          { status: 400 }
        );
      }

      const finalConfig = { ...{ strongThreshold: 0.7, mediumThreshold: 0.5, minThreshold: 0.3 }, ...config };
      const similarSentences = await findSimilarSentences(noteContent, 100); // Get many results

      // Convert to SemanticValidationResult format
      const strongMatches = similarSentences
        .filter(s => s.similarity >= finalConfig.strongThreshold)
        .map(s => ({
          text: s.sentence,
          matchedInjury: s.matchedInjury,
          similarity: s.similarity,
          originalCandidate: null,
          isStrongMatch: true,
        }));

      const mediumMatches = similarSentences
        .filter(s => s.similarity >= finalConfig.mediumThreshold && s.similarity < finalConfig.strongThreshold)
        .map(s => ({
          text: s.sentence,
          matchedInjury: s.matchedInjury,
          similarity: s.similarity,
          originalCandidate: null,
          isStrongMatch: false,
        }));

      const weakMatches = similarSentences
        .filter(s => s.similarity >= finalConfig.minThreshold && s.similarity < finalConfig.mediumThreshold)
        .map(s => ({
          text: s.sentence,
          matchedInjury: s.matchedInjury,
          similarity: s.similarity,
          originalCandidate: null,
          isStrongMatch: false,
        }));

      // All sentences that don't meet minimum threshold
      const sentences = noteContent.split(/[.!?]\s+/).map(s => s.trim()).filter(s => s.length > 10);
      const matchedSentences = new Set(similarSentences.map(s => s.sentence));
      const unmatched = sentences.filter(s => !matchedSentences.has(s));

      return NextResponse.json({
        mode: 'direct',
        strongMatches,
        mediumMatches,
        weakMatches,
        unmatched,
      });
    } else if (mode === 'find_sentences') {
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
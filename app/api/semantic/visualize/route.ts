/**
 * API Route: Semantic Validation Visualization
 * Returns embedding data for visualization purposes
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateSemantically, SemanticValidatorConfig } from '@/lib/semantic-validator';
import { Layer1Evidence } from '@/lib/rnd/schema';

export const runtime = 'nodejs';

interface EmbeddingData {
  text: string;
  embedding: number[];
  dimension: number;
  sampleValues: number[]; // First 20 values for visualization
}

interface VisualizationData {
  inputTexts: Array<{
    text: string;
    embedding: EmbeddingData;
  }>;
  injuryEmbeddings: Array<{
    injury: string;
    embedding: EmbeddingData;
  }>;
  comparisons: Array<{
    inputText: string;
    injury: string;
    similarity: number;
    dotProduct: number;
    normA: number;
    normB: number;
    cosineSimilarity: number;
  }>;
  matches: Array<{
    text: string;
    matchedInjury: string;
    similarity: number;
    rank: number;
  }>;
}

function cosineSimilarity(a: number[], b: number[]): { similarity: number; dotProduct: number; normA: number; normB: number } {
  if (a.length !== b.length) return { similarity: 0, dotProduct: 0, normA: 0, normB: 0 };
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  const similarity = denominator === 0 ? 0 : dotProduct / denominator;
  
  return { similarity, dotProduct, normA: Math.sqrt(normA), normB: Math.sqrt(normB) };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      layer1Evidence,
      config,
    }: {
      layer1Evidence?: Layer1Evidence;
      config?: SemanticValidatorConfig;
    } = body;

    if (!layer1Evidence || !layer1Evidence.injury_mentions) {
      return NextResponse.json(
        { error: 'layer1Evidence with injury_mentions is required' },
        { status: 400 }
      );
    }

    // Dynamic import to avoid blocking
    const { pipeline } = await import('@xenova/transformers');
    const { ALLOWED_INJURIES } = await import('@/lib/rnd/schema');
    
    const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

    // Get embeddings for injury mentions
    const inputEmbeddings: Array<{ text: string; embedding: number[] }> = [];
    for (const mention of layer1Evidence.injury_mentions) {
      if (!mention.text || mention.text.trim() === '') continue;
      
      const result = await pipe(mention.text, { pooling: 'mean', normalize: true });
      const embedding = Array.from(result.data as Float32Array);
      inputEmbeddings.push({ text: mention.text, embedding });
    }

    // Get embeddings for allowed injuries
    const injuryEmbeddings: Array<{ injury: string; embedding: number[] }> = [];
    for (const injury of ALLOWED_INJURIES) {
      const result = await pipe(injury, { pooling: 'mean', normalize: true });
      const embedding = Array.from(result.data as Float32Array);
      injuryEmbeddings.push({ injury, embedding });
    }

    // Calculate all comparisons
    const comparisons: Array<{
      inputText: string;
      injury: string;
      similarity: number;
      dotProduct: number;
      normA: number;
      normB: number;
      cosineSimilarity: number;
    }> = [];

    for (const input of inputEmbeddings) {
      for (const injury of injuryEmbeddings) {
        const { similarity, dotProduct, normA, normB } = cosineSimilarity(input.embedding, injury.embedding);
        comparisons.push({
          inputText: input.text,
          injury: injury.injury,
          similarity,
          dotProduct,
          normA,
          normB,
          cosineSimilarity: similarity,
        });
      }
    }

    // Get best matches
    const matches: Array<{ text: string; matchedInjury: string; similarity: number; rank: number }> = [];
    for (const input of inputEmbeddings) {
      const inputComparisons = comparisons.filter(c => c.inputText === input.text);
      const sorted = inputComparisons.sort((a, b) => b.similarity - a.similarity);
      sorted.forEach((comp, idx) => {
        matches.push({
          text: input.text,
          matchedInjury: comp.injury,
          similarity: comp.similarity,
          rank: idx + 1,
        });
      });
    }

    // Format for visualization (sample first 20 dimensions)
    const visualizationData: VisualizationData = {
      inputTexts: inputEmbeddings.map(input => ({
        text: input.text,
        embedding: {
          text: input.text,
          embedding: input.embedding,
          dimension: input.embedding.length,
          sampleValues: input.embedding.slice(0, 20),
        },
      })),
      injuryEmbeddings: injuryEmbeddings.map(injury => ({
        injury: injury.injury,
        embedding: {
          text: injury.injury,
          embedding: injury.embedding,
          dimension: injury.embedding.length,
          sampleValues: injury.embedding.slice(0, 20),
        },
      })),
      comparisons,
      matches,
    };

    return NextResponse.json(visualizationData);
  } catch (error: any) {
    console.error('Semantic visualization error:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate visualization data',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

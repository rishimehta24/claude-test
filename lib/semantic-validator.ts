/**
 * Semantic Validation using Sentence Transformers
 * Uses embeddings to validate and match injury mentions semantically
 */

import { pipeline } from '@xenova/transformers';
import { ALLOWED_INJURIES } from './rnd/schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let similarityPipeline: any = null;

/**
 * Initialize the similarity pipeline (lazy loading)
 */
async function getSimilarityPipeline(): Promise<any> {
  if (!similarityPipeline) {
    // Use 'Xenova/all-MiniLM-L6-v2' which is similar to all-MiniLM-L12-v2 but smaller/faster
    // For better accuracy, we could use 'Xenova/all-mpnet-base-v2' but it's larger
    similarityPipeline = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    );
  }
  return similarityPipeline;
}

/**
 * Compute cosine similarity between two embeddings
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Pre-compute embeddings for allowed injuries (cached)
 */
let injuryEmbeddingsCache: Map<string, number[]> | null = null;

async function getInjuryEmbeddings(): Promise<Map<string, number[]>> {
  if (injuryEmbeddingsCache) {
    return injuryEmbeddingsCache;
  }

  const pipe = await getSimilarityPipeline();
  const embeddings = new Map<string, number[]>();

  // Create embeddings for each allowed injury term
  for (const injury of ALLOWED_INJURIES) {
    const result = await pipe(injury, { pooling: 'mean', normalize: true });
    embeddings.set(injury, Array.from(result.data as Float32Array));
  }

  injuryEmbeddingsCache = embeddings;
  return embeddings;
}

export interface SemanticMatch {
  /** The original text from the note */
  text: string;
  /** The best matching allowed injury (by semantic similarity) */
  matchedInjury: string;
  /** Similarity score (0-1, higher is better) */
  similarity: number;
  /** Original injury_candidate from Layer 1 (if any) */
  originalCandidate: string | null;
  /** Whether this is a strong match (above threshold) */
  isStrongMatch: boolean;
}

export interface SemanticValidationResult {
  /** Matches found with high similarity */
  strongMatches: SemanticMatch[];
  /** Matches found with medium similarity */
  mediumMatches: SemanticMatch[];
  /** Matches found with low similarity (may not be valid) */
  weakMatches: SemanticMatch[];
  /** Phrases that couldn't be matched semantically */
  unmatched: string[];
}

export interface SemanticValidatorConfig {
  /** Threshold for strong matches (default 0.7) */
  strongThreshold?: number;
  /** Threshold for medium matches (default 0.5) */
  mediumThreshold?: number;
  /** Minimum threshold to consider a match at all (default 0.3) */
  minThreshold?: number;
}

const DEFAULT_CONFIG: Required<SemanticValidatorConfig> = {
  strongThreshold: 0.7,
  mediumThreshold: 0.5,
  minThreshold: 0.3,
};

/**
 * Validate injury mentions using semantic similarity
 * @param injuryMentions Array of injury mention texts from Layer 1
 * @param originalCandidates Map of text -> injury_candidate from Layer 1 (if any)
 * @param config Configuration for thresholds
 * @returns Semantic validation results
 */
export async function validateSemantically(
  injuryMentions: Array<{ text: string; injury_candidate: string | null }>,
  config: SemanticValidatorConfig = {}
): Promise<SemanticValidationResult> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const injuryEmbeddings = await getInjuryEmbeddings();
  const pipe = await getSimilarityPipeline();

  const allMatches: SemanticMatch[] = [];
  const unmatched: string[] = [];

  // Process each injury mention
  for (const mention of injuryMentions) {
    if (!mention.text || mention.text.trim() === '') continue;

    // Get embedding for this mention text
    const mentionResult = await pipe(mention.text, { pooling: 'mean', normalize: true });
    const mentionEmbedding = Array.from(mentionResult.data as Float32Array);

    // Find best matching injury
    let bestMatch: { injury: string; similarity: number } | null = null;

    for (const [injury, injuryEmbedding] of injuryEmbeddings.entries()) {
      const similarity = cosineSimilarity(mentionEmbedding, injuryEmbedding);
      
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { injury, similarity };
      }
    }

    if (bestMatch && bestMatch.similarity >= finalConfig.minThreshold) {
      allMatches.push({
        text: mention.text,
        matchedInjury: bestMatch.injury,
        similarity: bestMatch.similarity,
        originalCandidate: mention.injury_candidate,
        isStrongMatch: bestMatch.similarity >= finalConfig.strongThreshold,
      });
    } else {
      unmatched.push(mention.text);
    }
  }

  // Categorize matches by similarity
  const strongMatches = allMatches.filter(m => m.similarity >= finalConfig.strongThreshold);
  const mediumMatches = allMatches.filter(
    m => m.similarity >= finalConfig.mediumThreshold && m.similarity < finalConfig.strongThreshold
  );
  const weakMatches = allMatches.filter(
    m => m.similarity >= finalConfig.minThreshold && m.similarity < finalConfig.mediumThreshold
  );

  return {
    strongMatches,
    mediumMatches,
    weakMatches,
    unmatched,
  };
}

/**
 * Find semantically similar sentences in a note to injury terms
 * Useful for preprocessing or finding injury-related content
 */
export async function findSimilarSentences(
  noteContent: string,
  topK: number = 10
): Promise<Array<{ sentence: string; similarity: number; matchedInjury: string }>> {
  const sentences = noteContent
    .split(/[.!?]\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 10); // Filter out very short fragments

  if (sentences.length === 0) return [];

  const injuryEmbeddings = await getInjuryEmbeddings();
  const pipe = await getSimilarityPipeline();
  const results: Array<{ sentence: string; similarity: number; matchedInjury: string }> = [];

  for (const sentence of sentences) {
    const sentenceResult = await pipe(sentence, { pooling: 'mean', normalize: true });
    const sentenceEmbedding = Array.from(sentenceResult.data as Float32Array);

    // Find best matching injury for this sentence
    let bestMatch: { injury: string; similarity: number } | null = null;

    for (const [injury, injuryEmbedding] of injuryEmbeddings.entries()) {
      const similarity = cosineSimilarity(sentenceEmbedding, injuryEmbedding);
      
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { injury, similarity };
      }
    }

    if (bestMatch && bestMatch.similarity >= 0.3) {
      results.push({
        sentence,
        similarity: bestMatch.similarity,
        matchedInjury: bestMatch.injury,
      });
    }
  }

  // Sort by similarity and return top K
  return results.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
}
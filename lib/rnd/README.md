# R&D Project: Two-Layer Injury Extraction Pipeline

This is a research and development project to improve the injury extraction system by implementing a deterministic, auditable two-layer pipeline.

## Architecture

### Layer 1: LLM Evidence Extraction
- **Purpose**: Extract structured evidence from unstructured notes
- **Output**: JSON schema with injury mentions, negations, no-injury statements, timing markers, body sites
- **Non-deterministic**: Uses LLM, but outputs structured evidence, not final judgments
- **Temperature**: 0 (or as low as possible) for maximum determinism

### Layer 2: Deterministic Evaluator
- **Purpose**: Convert Layer 1 evidence into final injuries using pure code rules
- **Output**: Same format as existing system: `[{ phrase: "...", matched_injury: "..." }]` or `[]`
- **100% Deterministic**: Same input always produces same output
- **Configurable**: Rules can be adjusted without retraining

### Optional: Section Recognizer (Preprocessor)
- **Purpose**: Reduce input entropy by extracting relevant sections before Layer 1
- **Tenant-agnostic**: Works across different note formats
- **Optional**: Can be enabled/disabled per request

## Usage

### Basic Usage

```typescript
import { runPipeline, PipelineConfig } from '@/lib/rnd/pipeline';

const config: PipelineConfig = {
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  model: 'claude-sonnet-4-5-20250929',
  temperature: 0,
  maxTokens: 2000,
  useSectionRecognizer: false,
};

const result = await runPipeline(noteContent, config);

if (result.error) {
  console.error('Pipeline error:', result.error);
} else {
  console.log('Final injuries:', result.finalInjuries);
  console.log('Layer 1 evidence:', result.layer1Evidence);
}
```

### API Endpoint

POST `/api/rnd/extract`

Request body:
```json
{
  "noteContent": "Post fall. New 3cm skin tear on right forearm...",
  "config": {
    "model": "claude-sonnet-4-5-20250929",
    "temperature": 0,
    "maxTokens": 2000,
    "useSectionRecognizer": false,
    "evaluatorConfig": {
      "excludeNegated": true,
      "respectNoInjuryStatements": true,
      "preferExplicit": true,
      "strictPainEvaluation": true,
      "requireExactMatch": true
    }
  }
}
```

Response:
```json
{
  "success": true,
  "result": {
    "finalInjuries": [
      { "phrase": "3cm skin tear on right forearm", "matched_injury": "skin tear" }
    ],
    "layer1Evidence": { ... },
    "rawLayer1Response": "...",
    "error": null,
    "usedSectionRecognizer": false,
    "originalNote": "...",
    "preprocessedNote": undefined
  }
}
```

### Running Tests

```typescript
import { runTests } from '@/lib/rnd/evaluator.test';

runTests();
```

## Layer 1 Evidence Schema

```typescript
interface Layer1Evidence {
  injury_mentions: Array<{
    text: string;
    injury_candidate: AllowedInjury | null;
    body_site: string | null;
    is_negated: boolean;
    negation_text: string | null;
    temporal_relation_to_fall: "post_fall" | "during_fall" | "pre_fall" | "unknown";
    certainty: "explicit" | "implied" | "unclear";
    start_char: number;
    end_char: number;
  }>;
  negations: Array<{
    text: string;
    scope_hint: string | null;
    start_char: number;
    end_char: number;
  }>;
  no_injury_statements: Array<{
    text: string;
    start_char: number;
    end_char: number;
  }>;
  timing_markers: Array<{
    text: string;
    start_char: number;
    end_char: number;
  }>;
  body_sites: Array<{
    text: string;
    start_char: number;
    end_char: number;
  }>;
  metadata: {
    model_version: string;
    extraction_warnings: string[];
  };
}
```

## Deterministic Evaluator Rules

1. **Allowed Injuries Filter**: Only consider `injury_mentions` where `injury_candidate` is in the Allowed_Injuries list
2. **Negation Exclusion**: Exclude any mention with `is_negated=true`
3. **No Injury Statements**: If a global `no_injury_statement` exists, return `[]` UNLESS there's at least one explicit injury mention after it (using char offsets)
4. **Prefer Explicit**: Prefer explicit mentions over implied/unclear
5. **Pain Special Handling**: For "pain", only accept if tied to body site OR post-fall context
6. **Deduplication**: Deduplicate by `(matched_injury + normalized phrase)`, keeping the longer/more specific phrase
7. **Stable Sorting**: Sort by `start_char` (position in note), then by injury type

## Files

- `schema.ts`: TypeScript types and schema definitions
- `prompts.ts`: Layer 1 LLM prompts (SYSTEM + USER templates)
- `evaluator.ts`: Deterministic evaluator implementation
- `evaluator.test.ts`: Unit tests for evaluator
- `section-recognizer.ts`: Optional preprocessor for section recognition
- `pipeline.ts`: Main orchestrator combining Layer 1 + Layer 2
- `index.ts`: Main exports

## Advantages Over Single-Layer Approach

1. **Determinism**: Layer 2 is 100% deterministic code, ensuring same input → same output
2. **Auditability**: Layer 1 evidence is preserved, allowing full traceability
3. **Explainability**: Can explain why each injury was included/excluded
4. **Flexibility**: Rules can be adjusted without retraining LLM
5. **Reduced Non-Determinism**: LLM only extracts evidence, not final judgments
6. **Better Handling of Edge Cases**: Explicit rules for negation, timing, pain, etc.

## Comparison with Existing System

| Aspect | Existing System | R&D Two-Layer Pipeline |
|--------|----------------|------------------------|
| Determinism | Non-deterministic (LLM makes final judgment) | Deterministic (LLM extracts evidence, code makes judgment) |
| Auditability | Limited (only final output) | Full (evidence + evaluation trace) |
| Rule Changes | Requires prompt changes + retraining | Only requires code changes |
| Edge Case Handling | Relies on prompt quality | Explicit code rules |
| Output Format | `[{ phrase, matched_injury }]` or `[]` | Same format (compatible) |

## Testing

Run the unit tests:

```bash
# If you have a TypeScript test runner configured
npm test -- lib/rnd/evaluator.test.ts

# Or run the test function directly
node -r ts-node/register lib/rnd/evaluator.test.ts
```

## Future Enhancements

- [ ] Add more sophisticated section recognition
- [ ] Add confidence scores to final injuries
- [ ] Add explanation generation from evidence
- [ ] Performance optimization for large notes
- [ ] Batch processing support
- [ ] Metrics and monitoring
- [ ] A/B testing framework
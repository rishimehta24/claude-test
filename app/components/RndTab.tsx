'use client';

import { useState } from 'react';

interface Layer1Evidence {
  injury_mentions: Array<{
    text: string;
    injury_candidate: string | null;
    body_site: string | null;
    is_negated: boolean;
    negation_text: string | null;
    temporal_relation_to_fall: string;
    certainty: string;
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

interface PipelineResult {
  finalInjuries: Array<{ phrase: string; matched_injury: string }> | [];
  layer1Evidence: Layer1Evidence | null;
  rawLayer1Response: string | null;
  error: string | null;
  usedSectionRecognizer: boolean;
  originalNote: string;
  preprocessedNote?: string;
}

export default function RndTab() {
  const [noteContent, setNoteContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [useSectionRecognizer, setUseSectionRecognizer] = useState(false);
  const [model, setModel] = useState('claude-sonnet-4-5-20250929');
  const [temperature, setTemperature] = useState(0);

  const handleExtract = async () => {
    if (!noteContent.trim()) {
      alert('Please enter note content');
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/rnd/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          noteContent,
          config: {
            model,
            temperature,
            maxTokens: 2000,
            useSectionRecognizer,
            evaluatorConfig: {
              excludeNegated: true,
              respectNoInjuryStatements: true,
              preferExplicit: true,
              strictPainEvaluation: true,
              requireExactMatch: true,
            },
          },
        }),
      });

      const data = await response.json();

      if (data.success && data.result) {
        setResult(data.result);
      } else {
        setResult({
          finalInjuries: [],
          layer1Evidence: null,
          rawLayer1Response: null,
          error: data.error || 'Unknown error',
          usedSectionRecognizer: false,
          originalNote: noteContent,
        });
      }
    } catch (error: any) {
      setResult({
        finalInjuries: [],
        layer1Evidence: null,
        rawLayer1Response: null,
        error: error.message || 'Failed to extract injuries',
        usedSectionRecognizer: false,
        originalNote: noteContent,
      });
    } finally {
      setLoading(false);
    }
  };

  const exampleNotes = [
    {
      name: 'Multiple Injuries',
      content: 'New 3cm skin tear on right forearm, with minor bleeding. Area is red and swollen. Resident denies other pain.',
    },
    {
      name: 'No Injuries',
      content: 'Unwitnessed fall. Assessed from head to toe, no cuts or bruises observed. Resident states they feel fine.',
    },
    {
      name: 'Conflicting Note',
      content: 'Post fall assessment at 10:00 AM. No injuries noted during initial check. Later at 2:00 PM, resident reported new skin tear on left arm.',
    },
    {
      name: 'Pain with Body Site',
      content: 'Resident reports pain in right shoulder after fall. No other complaints.',
    },
  ];

  const loadExample = (content: string) => {
    setNoteContent(content);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
        <h2 className="text-2xl font-bold text-black mb-4">
          R&D Two-Layer Injury Extraction Pipeline
        </h2>
        
        {/* Detailed Process Explanation */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-300">
          <h3 className="text-lg font-bold text-black mb-3">How The Two-Layer Process Works</h3>
          <div className="space-y-3 text-black text-sm leading-relaxed">
            <div>
              <strong className="text-black">STEP 1: Optional Preprocessing (Section Recognizer)</strong>
              <p className="mt-1 ml-4">If enabled, the note is preprocessed to identify and extract relevant sections (e.g., assessment, injury, vitals). This reduces input entropy before sending to the LLM, but preserves character positions for accurate mapping.</p>
            </div>
            <div>
              <strong className="text-black">STEP 2: Layer 1 - LLM Evidence Extraction</strong>
              <p className="mt-1 ml-4">An LLM (with temperature=0 for maximum determinism) extracts structured evidence from the note. The LLM does NOT make final judgments about injuries. Instead, it outputs a JSON object containing:</p>
              <ul className="mt-1 ml-8 list-disc space-y-1">
                <li><strong>injury_mentions</strong>: All phrases that might indicate injuries (even if negated or unclear), with exact quotes, body sites, temporal relations, and certainty levels</li>
                <li><strong>negations</strong>: Phrases that deny injuries (e.g., "denies pain", "no bruising")</li>
                <li><strong>no_injury_statements</strong>: Explicit statements like "no injuries noted" or "no injury identified"</li>
                <li><strong>timing_markers</strong>: Temporal references like "post fall", "after fall", "yesterday"</li>
                <li><strong>body_sites</strong>: Anatomical locations mentioned (e.g., "right forearm", "left knee")</li>
                <li><strong>metadata</strong>: Model version and extraction warnings</li>
              </ul>
            </div>
            <div>
              <strong className="text-black">STEP 3: Layer 2 - Deterministic Evaluation (Pure Code)</strong>
              <p className="mt-1 ml-4">Deterministic code rules (100% reproducible) evaluate the Layer 1 evidence to produce the final injuries output. The same evidence always produces the same result. Rules include:</p>
              <ul className="mt-1 ml-8 list-disc space-y-1">
                <li>Only consider injury_mentions where injury_candidate matches the Allowed_Injuries list</li>
                <li>Exclude any mention marked as negated (is_negated=true)</li>
                <li>If a global no_injury_statement exists, return empty array UNLESS there's at least one explicit injury mention AFTER it (using character offsets)</li>
                <li>Prefer explicit mentions over implied/unclear ones</li>
                <li>For "pain", only accept if tied to a body site OR post-fall context (otherwise too ambiguous)</li>
                <li>Deduplicate by injury type, keeping the longer/more specific phrase</li>
                <li>Sort by position in note (start_char), then by injury type alphabetically</li>
              </ul>
              <p className="mt-2 ml-4">Output format: Same as existing system - <code className="bg-gray-200 px-1 rounded">[{`{phrase: "...", matched_injury: "..."}`}]</code> or <code className="bg-gray-200 px-1 rounded">[]</code> if no injuries.</p>
            </div>
            <div className="pt-2 border-t border-gray-300">
              <strong className="text-black">Why This Approach?</strong>
              <p className="mt-1 ml-4">This two-layer design separates evidence extraction (LLM, non-deterministic but flexible) from decision-making (code, 100% deterministic). This provides:</p>
              <ul className="mt-1 ml-8 list-disc space-y-1">
                <li><strong>Determinism</strong>: Same input always produces same output (via Layer 2 rules)</li>
                <li><strong>Auditability</strong>: Layer 1 evidence is preserved, so you can trace why each injury was included/excluded</li>
                <li><strong>Explainability</strong>: Can explain decisions based on evidence and rules</li>
                <li><strong>Flexibility</strong>: Rules can be adjusted without retraining LLM</li>
                <li><strong>Compatibility</strong>: Output format matches existing system</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Configuration */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg space-y-4">
          <h3 className="font-semibold text-black">Configuration</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-black mb-2">
                Model
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="claude-sonnet-4-5-20250929">claude-sonnet-4-5-20250929</option>
                <option value="claude-haiku-4-5-20251001">claude-haiku-4-5-20251001</option>
                <option value="claude-opus-4-5-20251101">claude-opus-4-5-20251101</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-black mb-2">
                Temperature
              </label>
              <input
                type="number"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                min={0}
                max={1}
                step={0.1}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="useSectionRecognizer"
              checked={useSectionRecognizer}
              onChange={(e) => setUseSectionRecognizer(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <label htmlFor="useSectionRecognizer" className="text-sm font-medium text-black">
              Use Section Recognizer (preprocessor)
            </label>
          </div>
        </div>

        {/* Note Input */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-black">
              Note Content
            </label>
            <div className="flex gap-2 flex-wrap">
              {exampleNotes.map((example, idx) => (
                <button
                  key={idx}
                  onClick={() => loadExample(example.content)}
                  className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 text-black rounded transition-colors"
                >
                  {example.name}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            placeholder="Enter medical note content here..."
            className="w-full h-40 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
          />
        </div>

        <button
          onClick={handleExtract}
          disabled={loading || !noteContent.trim()}
          className="w-full md:w-auto px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-semibold"
        >
          {loading ? 'Extracting...' : 'Extract Injuries'}
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Final Injuries */}
          <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
            <h3 className="text-xl font-bold text-black mb-4">
              Final Injuries (Layer 2 Output)
            </h3>
            {result.error ? (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-black font-semibold">Error: {result.error}</p>
              </div>
            ) : (
              <div>
                {result.finalInjuries.length === 0 ? (
                  <p className="text-black italic">No injuries detected (empty array)</p>
                ) : (
                  <pre className="bg-gray-50 p-4 rounded-lg border border-gray-200 overflow-x-auto text-sm text-black">
                    {JSON.stringify(result.finalInjuries, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>

          {/* Layer 1 Evidence */}
          {result.layer1Evidence && !result.error && (
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
              <h3 className="text-xl font-bold text-black mb-4">
                Layer 1 Evidence (for auditing)
              </h3>
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold text-black mb-2">Summary</h4>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                    <div className="bg-blue-50 p-3 rounded border border-gray-300">
                      <div className="font-semibold text-black">Injury Mentions</div>
                      <div className="text-2xl font-bold text-black">
                        {result.layer1Evidence.injury_mentions.length}
                      </div>
                    </div>
                    <div className="bg-yellow-50 p-3 rounded border border-gray-300">
                      <div className="font-semibold text-black">Negations</div>
                      <div className="text-2xl font-bold text-black">
                        {result.layer1Evidence.negations.length}
                      </div>
                    </div>
                    <div className="bg-green-50 p-3 rounded border border-gray-300">
                      <div className="font-semibold text-black">No Injury Statements</div>
                      <div className="text-2xl font-bold text-black">
                        {result.layer1Evidence.no_injury_statements.length}
                      </div>
                    </div>
                    <div className="bg-purple-50 p-3 rounded border border-gray-300">
                      <div className="font-semibold text-black">Timing Markers</div>
                      <div className="text-2xl font-bold text-black">
                        {result.layer1Evidence.timing_markers.length}
                      </div>
                    </div>
                    <div className="bg-indigo-50 p-3 rounded border border-gray-300">
                      <div className="font-semibold text-black">Body Sites</div>
                      <div className="text-2xl font-bold text-black">
                        {result.layer1Evidence.body_sites.length}
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-black mb-2">Full Evidence JSON</h4>
                  <details className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <summary className="cursor-pointer text-sm font-medium text-black hover:underline">
                      Click to expand Layer 1 evidence
                    </summary>
                    <pre className="mt-4 text-xs overflow-x-auto max-h-96 overflow-y-auto text-black">
                      {JSON.stringify(result.layer1Evidence, null, 2)}
                    </pre>
                  </details>
                </div>

                {result.usedSectionRecognizer && result.preprocessedNote && (
                  <div>
                    <h4 className="font-semibold text-black mb-2">Preprocessed Note (Section Recognizer)</h4>
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 text-sm whitespace-pre-wrap max-h-40 overflow-y-auto text-black">
                      {result.preprocessedNote}
                    </div>
                  </div>
                )}

                {result.layer1Evidence.metadata.extraction_warnings.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <h4 className="font-semibold text-black mb-2">Warnings</h4>
                    <ul className="list-disc list-inside text-sm text-black">
                      {result.layer1Evidence.metadata.extraction_warnings.map((warning, idx) => (
                        <li key={idx}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
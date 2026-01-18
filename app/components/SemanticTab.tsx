'use client';

import { useState } from 'react';
import { ALL_MODELS } from '@/lib/constants';
import type { Layer1Evidence, FinalInjuries } from '@/lib/rnd/schema';

interface SemanticMatch {
  text: string;
  matchedInjury: string;
  similarity: number;
  originalCandidate: string | null;
  isStrongMatch: boolean;
}

interface SemanticValidationResult {
  strongMatches: SemanticMatch[];
  mediumMatches: SemanticMatch[];
  weakMatches: SemanticMatch[];
  unmatched: string[];
}

interface SemanticLLMResult {
  semanticMatches: {
    strong: Array<{ sentence: string; similarity: number; matchedInjury: string }>;
    medium: Array<{ sentence: string; similarity: number; matchedInjury: string }>;
    weak: Array<{ sentence: string; similarity: number; matchedInjury: string }>;
    all: Array<{ sentence: string; similarity: number; matchedInjury: string }>;
  };
  llmResponse: string;
  finalInjuries: Array<{ phrase: string; matched_injury: string }>;
  matchesTable: string;
}

export default function SemanticTab() {
  const [subTab, setSubTab] = useState<'layer1' | 'direct' | 'semantic_llm'>('layer1');
  const [noteContent, setNoteContent] = useState('');
  const [model, setModel] = useState(ALL_MODELS[0].id);
  const [temperature, setTemperature] = useState(0);
  const [strongThreshold, setStrongThreshold] = useState(0.7);
  const [mediumThreshold, setMediumThreshold] = useState(0.5);
  const [minThreshold, setMinThreshold] = useState(0.3);
  const [loading, setLoading] = useState(false);
  const [layer1Evidence, setLayer1Evidence] = useState<Layer1Evidence | null>(null);
  const [semanticResult, setSemanticResult] = useState<SemanticValidationResult | null>(null);
  const [semanticLLMResult, setSemanticLLMResult] = useState<SemanticLLMResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRunLayer1 = async () => {
    if (!noteContent.trim()) {
      setError('Please enter a note');
      return;
    }

    setLoading(true);
    setError(null);
    setSemanticResult(null);

    try {
      const response = await fetch('/api/rnd/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteContent,
          config: {
            model,
            temperature,
            useSectionRecognizer: false,
            maxTokens: 2000,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to run Layer 1 extraction');
      }

      const data = await response.json();
      console.log('Layer 1 API Response:', data);
      
      // Show error if there was one in the result (even if HTTP 200)
      if (data.result && data.result.error) {
        throw new Error(data.result.error);
      }
      
      // Handle both response formats: {result: {layer1Evidence}} or {layer1Evidence} directly
      let layer1EvidenceData = null;
      if (data.result && data.result.layer1Evidence !== undefined) {
        // API route returns {success, result: {layer1Evidence, ...}}
        layer1EvidenceData = data.result.layer1Evidence;
      } else if (data.layer1Evidence !== undefined) {
        // Direct format
        layer1EvidenceData = data.layer1Evidence;
      } else {
        console.error('Invalid response format:', data);
        throw new Error('Invalid response format: missing layer1Evidence. Response: ' + JSON.stringify(data).substring(0, 200));
      }
      
      if (layer1EvidenceData === null) {
        throw new Error('Layer 1 extraction returned null evidence. Check the raw response for details.');
      }
      
      console.log('Setting Layer 1 Evidence:', layer1EvidenceData);
      setLayer1Evidence(layer1EvidenceData);
    } catch (err: any) {
      setError(err.message || 'Failed to run Layer 1 extraction');
    } finally {
      setLoading(false);
    }
  };

  const handleRunSemanticValidation = async () => {
    if (!layer1Evidence || !layer1Evidence.injury_mentions.length) {
      setError('Please run Layer 1 extraction first or ensure there are injury mentions');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/semantic/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layer1Evidence,
          config: {
            strongThreshold,
            mediumThreshold,
            minThreshold,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to run semantic validation');
      }

      const data = await response.json();
      setSemanticResult(data);
    } catch (err: any) {
      setError(err.message || 'Failed to run semantic validation');
    } finally {
      setLoading(false);
    }
  };

  const handleDirectSemanticValidation = async () => {
    if (!noteContent.trim()) {
      setError('Please enter a note');
      return;
    }

    setLoading(true);
    setError(null);
    setSemanticResult(null);

    try {
      const response = await fetch('/api/semantic/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteContent,
          mode: 'direct',
          config: {
            strongThreshold,
            mediumThreshold,
            minThreshold,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to run direct semantic validation');
      }

      const data = await response.json();
      setSemanticResult(data);
    } catch (err: any) {
      setError(err.message || 'Failed to run direct semantic validation');
    } finally {
      setLoading(false);
    }
  };

  const handleSemanticLLMRefinement = async () => {
    if (!noteContent.trim()) {
      setError('Please enter a note');
      return;
    }

    setLoading(true);
    setError(null);
    setSemanticLLMResult(null);
    setSemanticResult(null);

    try {
      const response = await fetch('/api/semantic/llm-refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteContent,
          model,
          config: {
            strongThreshold,
            mediumThreshold,
            minThreshold,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to run semantic + LLM refinement');
      }

      const data = await response.json();
      setSemanticLLMResult(data);
    } catch (err: any) {
      setError(err.message || 'Failed to run semantic + LLM refinement');
    } finally {
      setLoading(false);
    }
  };

  const handleFindSimilarSentences = async () => {
    if (!noteContent.trim()) {
      setError('Please enter a note');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/semantic/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteContent,
          mode: 'find_sentences',
          config: {
            strongThreshold: 10, // top K
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to find similar sentences');
      }

      const data = await response.json();
      // Display results in a friendly way
      console.log('Similar sentences:', data.similarSentences);
      alert(`Found ${data.similarSentences.length} similar sentences. Check console for details.`);
    } catch (err: any) {
      setError(err.message || 'Failed to find similar sentences');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 text-black">
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-2xl font-bold mb-4">Semantic Validation with Sentence Transformers</h2>
        <p className="mb-6 text-gray-700">
          This tool uses sentence embeddings to validate and match injury mentions semantically.
          It can help identify injuries even when wording differs from exact keywords, and can
          validate Layer 1 extractions against the allowed injury list.
        </p>

        {/* Subtabs */}
        <div className="flex gap-2 mb-4 border-b border-gray-200">
          <button
            onClick={() => {
              setSubTab('layer1');
              setSemanticResult(null);
              setLayer1Evidence(null);
            }}
            className={`px-4 py-2 font-semibold transition-colors ${
              subTab === 'layer1'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Layer 1 + Validation
          </button>
          <button
            onClick={() => {
              setSubTab('direct');
              setSemanticResult(null);
              setSemanticLLMResult(null);
              setLayer1Evidence(null);
            }}
            className={`px-4 py-2 font-semibold transition-colors ${
              subTab === 'direct'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Direct (No Layer 1)
          </button>
          <button
            onClick={() => {
              setSubTab('semantic_llm');
              setSemanticResult(null);
              setLayer1Evidence(null);
            }}
            className={`px-4 py-2 font-semibold transition-colors ${
              subTab === 'semantic_llm'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Semantic + LLM (Hybrid)
          </button>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-2">Nurse Note</label>
            <textarea
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="Paste nurse note here..."
              className="w-full p-3 border border-gray-300 rounded-md h-32"
            />
          </div>

          {(subTab === 'layer1' || subTab === 'semantic_llm') && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Model{subTab === 'semantic_llm' ? ' (for LLM refinement)' : ' (for Layer 1)'}
                </label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md"
                >
                  {ALL_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </div>

              {subTab === 'layer1' && (
                <div>
                  <label className="block text-sm font-medium mb-2">Temperature</label>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.1"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="w-full p-2 border border-gray-300 rounded-md"
                  />
                </div>
              )}
            </div>
          )}

          <div className="border-t pt-4">
            <h3 className="font-semibold mb-3">Semantic Thresholds</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Strong Match (&ge;)</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={strongThreshold}
                  onChange={(e) => setStrongThreshold(parseFloat(e.target.value))}
                  className="w-full p-2 border border-gray-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Medium Match (&ge;)</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={mediumThreshold}
                  onChange={(e) => setMediumThreshold(parseFloat(e.target.value))}
                  className="w-full p-2 border border-gray-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Min Threshold (&ge;)</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={minThreshold}
                  onChange={(e) => setMinThreshold(parseFloat(e.target.value))}
                  className="w-full p-2 border border-gray-300 rounded-md"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            {subTab === 'layer1' ? (
              <>
                <button
                  onClick={handleRunLayer1}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? 'Running...' : 'Step 1: Run Layer 1 Extraction'}
                </button>
                <button
                  onClick={handleRunSemanticValidation}
                  disabled={loading || !layer1Evidence}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                >
                  Step 2: Run Semantic Validation
                </button>
                <button
                  onClick={handleFindSimilarSentences}
                  disabled={loading}
                  className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
                >
                  Find Similar Sentences in Note
                </button>
              </>
            ) : subTab === 'semantic_llm' ? (
              <button
                onClick={handleSemanticLLMRefinement}
                disabled={loading}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                {loading ? 'Running Semantic + LLM...' : 'Run Semantic + LLM Refinement'}
              </button>
            ) : (
              <button
                onClick={handleDirectSemanticValidation}
                disabled={loading}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? 'Running...' : 'Run Direct Semantic Validation'}
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-md">
            {error}
          </div>
        )}
      </div>

      {subTab === 'layer1' && layer1Evidence && (
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h3 className="text-xl font-bold mb-3">Layer 1 Evidence</h3>
          <div className="space-y-3">
            <div>
              <span className="font-semibold">Injury Mentions Found: </span>
              <span>{layer1Evidence.injury_mentions.length}</span>
            </div>
            {layer1Evidence.injury_mentions.length > 0 && (
              <div className="border rounded-md p-3">
                <ul className="list-disc list-inside space-y-2">
                  {layer1Evidence.injury_mentions.map((mention, idx) => (
                    <li key={idx} className="text-sm">
                      <span className="font-mono">"{mention.text}"</span>
                      {mention.injury_candidate && (
                        <span className="ml-2 text-green-700">
                          → {mention.injury_candidate}
                        </span>
                      )}
                      {mention.is_negated && (
                        <span className="ml-2 text-red-600">(NEGATED)</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {semanticResult && (
        <div className="bg-white p-6 rounded-lg shadow-md space-y-4">
          <h3 className="text-xl font-bold mb-3">Semantic Validation Results</h3>

          {semanticResult.strongMatches.length > 0 && (
            <div>
              <h4 className="font-semibold text-green-700 mb-2">
                Strong Matches ({semanticResult.strongMatches.length})
              </h4>
              <div className="border rounded-md p-3 bg-green-50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Text</th>
                      <th className="text-left p-2">Semantic Match</th>
                      <th className="text-left p-2">Layer 1 Candidate</th>
                      <th className="text-left p-2">Similarity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {semanticResult.strongMatches.map((match, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2 font-mono text-xs">"{match.text}"</td>
                        <td className="p-2 text-green-700 font-semibold">{match.matchedInjury}</td>
                        <td className="p-2">
                          {match.originalCandidate || (
                            <span className="text-gray-400">null</span>
                          )}
                        </td>
                        <td className="p-2">
                          <span className="font-mono">{(match.similarity * 100).toFixed(1)}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {semanticResult.mediumMatches.length > 0 && (
            <div>
              <h4 className="font-semibold text-yellow-700 mb-2">
                Medium Matches ({semanticResult.mediumMatches.length})
              </h4>
              <div className="border rounded-md p-3 bg-yellow-50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Text</th>
                      <th className="text-left p-2">Semantic Match</th>
                      <th className="text-left p-2">Layer 1 Candidate</th>
                      <th className="text-left p-2">Similarity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {semanticResult.mediumMatches.map((match, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2 font-mono text-xs">"{match.text}"</td>
                        <td className="p-2 text-yellow-700 font-semibold">
                          {match.matchedInjury}
                        </td>
                        <td className="p-2">
                          {match.originalCandidate || (
                            <span className="text-gray-400">null</span>
                          )}
                        </td>
                        <td className="p-2">
                          <span className="font-mono">{(match.similarity * 100).toFixed(1)}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {semanticResult.weakMatches.length > 0 && (
            <div>
              <h4 className="font-semibold text-orange-700 mb-2">
                Weak Matches ({semanticResult.weakMatches.length})
              </h4>
              <div className="border rounded-md p-3 bg-orange-50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Text</th>
                      <th className="text-left p-2">Semantic Match</th>
                      <th className="text-left p-2">Layer 1 Candidate</th>
                      <th className="text-left p-2">Similarity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {semanticResult.weakMatches.map((match, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2 font-mono text-xs">"{match.text}"</td>
                        <td className="p-2 text-orange-700 font-semibold">
                          {match.matchedInjury}
                        </td>
                        <td className="p-2">
                          {match.originalCandidate || (
                            <span className="text-gray-400">null</span>
                          )}
                        </td>
                        <td className="p-2">
                          <span className="font-mono">{(match.similarity * 100).toFixed(1)}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {semanticResult.unmatched.length > 0 && (
            <div>
              <h4 className="font-semibold text-red-700 mb-2">
                Unmatched ({semanticResult.unmatched.length})
              </h4>
              <div className="border rounded-md p-3 bg-red-50">
                <ul className="list-disc list-inside space-y-1">
                  {semanticResult.unmatched.map((text, idx) => (
                    <li key={idx} className="text-sm font-mono">"{text}"</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {semanticLLMResult && (
        <div className="space-y-6">
          {/* Semantic Validation Results Table */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-xl font-bold mb-3">Step 1: Semantic Validation Results (Free)</h3>
            <p className="text-sm text-gray-600 mb-4">
              The semantic validation found {semanticLLMResult.semanticMatches.all.length} potential injury matches. 
              These are shown below organized by confidence level. The LLM will review this table to make final decisions.
            </p>

            {(semanticLLMResult.semanticMatches.strong.length > 0 || 
              semanticLLMResult.semanticMatches.medium.length > 0 || 
              semanticLLMResult.semanticMatches.weak.length > 0) && (
              <div className="space-y-4">
                {semanticLLMResult.semanticMatches.strong.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-green-700 mb-2">
                      Strong Matches ({semanticLLMResult.semanticMatches.strong.length})
                    </h4>
                    <div className="border rounded-md p-3 bg-green-50">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left p-2">Text</th>
                            <th className="text-left p-2">Matched Injury</th>
                            <th className="text-left p-2">Similarity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {semanticLLMResult.semanticMatches.strong.map((match, idx) => (
                            <tr key={idx} className="border-b">
                              <td className="p-2 font-mono text-xs">"{match.sentence}"</td>
                              <td className="p-2 text-green-700 font-semibold">{match.matchedInjury}</td>
                              <td className="p-2 font-mono">{(match.similarity * 100).toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {semanticLLMResult.semanticMatches.medium.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-yellow-700 mb-2">
                      Medium Matches ({semanticLLMResult.semanticMatches.medium.length})
                    </h4>
                    <div className="border rounded-md p-3 bg-yellow-50">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left p-2">Text</th>
                            <th className="text-left p-2">Matched Injury</th>
                            <th className="text-left p-2">Similarity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {semanticLLMResult.semanticMatches.medium.map((match, idx) => (
                            <tr key={idx} className="border-b">
                              <td className="p-2 font-mono text-xs">"{match.sentence}"</td>
                              <td className="p-2 text-yellow-700 font-semibold">{match.matchedInjury}</td>
                              <td className="p-2 font-mono">{(match.similarity * 100).toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {semanticLLMResult.semanticMatches.weak.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-orange-700 mb-2">
                      Weak Matches ({semanticLLMResult.semanticMatches.weak.length})
                    </h4>
                    <div className="border rounded-md p-3 bg-orange-50">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left p-2">Text</th>
                            <th className="text-left p-2">Matched Injury</th>
                            <th className="text-left p-2">Similarity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {semanticLLMResult.semanticMatches.weak.map((match, idx) => (
                            <tr key={idx} className="border-b">
                              <td className="p-2 font-mono text-xs">"{match.sentence}"</td>
                              <td className="p-2 text-orange-700 font-semibold">{match.matchedInjury}</td>
                              <td className="p-2 font-mono">{(match.similarity * 100).toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* LLM Final Output */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-xl font-bold mb-3">Step 2: LLM Refinement Results</h3>
            <p className="text-sm text-gray-600 mb-4">
              The LLM reviewed the semantic validation table above and applied clinical reasoning to determine 
              the final list of actual injuries. This filters out false positives, negations, and non-injury symptoms.
            </p>

            {semanticLLMResult.finalInjuries.length > 0 ? (
              <div className="border rounded-md p-4 bg-blue-50">
                <h4 className="font-semibold text-blue-900 mb-3">
                  Final Injuries ({semanticLLMResult.finalInjuries.length})
                </h4>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Phrase (from note)</th>
                      <th className="text-left p-2">Matched Injury</th>
                    </tr>
                  </thead>
                  <tbody>
                    {semanticLLMResult.finalInjuries.map((injury, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2 font-mono text-xs">"{injury.phrase}"</td>
                        <td className="p-2 text-blue-700 font-semibold">{injury.matched_injury}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="border rounded-md p-4 bg-gray-50">
                <p className="text-gray-600">No injuries identified after LLM refinement.</p>
              </div>
            )}

            {/* Raw LLM Response */}
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold text-gray-700 hover:text-gray-900">
                View Raw LLM Response
              </summary>
              <div className="mt-2 p-3 bg-gray-50 rounded border border-gray-200">
                <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto">
                  {semanticLLMResult.llmResponse}
                </pre>
              </div>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}
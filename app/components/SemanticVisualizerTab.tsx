'use client';

import { useState } from 'react';
import { ALL_MODELS } from '@/lib/constants';
import type { Layer1Evidence } from '@/lib/rnd/schema';

interface EmbeddingData {
  text: string;
  embedding: number[];
  dimension: number;
  sampleValues: number[];
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

const EXAMPLE_NOTE = `Effective Date: 11/24/2025 12:15Type: RNAO - Post Fall Assessment Section B Post Fall Assessment : Fall was witnessed. Date and time the Resident fell or was found: 11/24/2025 12:15 PMDate and time of notification: 11/24/2025Name of SDM/POA contacted. Vicky and Brian TiltWitness report: Resident was standing in elevator with Lindsay PSW and start telling that she feeling dizzy and Lindsy said by the time while she was trying to help Linda she fell and hit her head on elevator wallResident's description of the fall: Feeling DizzyResident does not have any fall-related injury/injuries or verbal/non-verbal indicators of pain. Resident shows signs of new pain after fall. Resident hit their head. Resident is drowsy. Resident did not experience a change in their usual level of mobility.`;

export default function SemanticVisualizerTab() {
  const [noteContent, setNoteContent] = useState(EXAMPLE_NOTE);
  const [model, setModel] = useState(ALL_MODELS[0].id);
  const [temperature, setTemperature] = useState(0);
  const [loading, setLoading] = useState(false);
  const [layer1Evidence, setLayer1Evidence] = useState<Layer1Evidence | null>(null);
  const [visualizationData, setVisualizationData] = useState<VisualizationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedInput, setSelectedInput] = useState<string | null>(null);

  const handleRunLayer1 = async () => {
    if (!noteContent.trim()) {
      setError('Please enter a note');
      return;
    }

    setLoading(true);
    setError(null);
    setVisualizationData(null);
    setLayer1Evidence(null);

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
      
      if (!data.result) {
        throw new Error('Invalid response format: missing result');
      }
      
      if (data.result.error) {
        throw new Error(data.result.error);
      }
      
      if (data.result.layer1Evidence === null) {
        throw new Error('Layer 1 extraction returned null evidence');
      }
      
      setLayer1Evidence(data.result.layer1Evidence);
    } catch (err: any) {
      setError(err.message || 'Failed to run Layer 1 extraction');
    } finally {
      setLoading(false);
    }
  };

  const handleVisualize = async () => {
    if (!layer1Evidence || !layer1Evidence.injury_mentions.length) {
      setError('Please run Layer 1 extraction first');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/semantic/visualize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layer1Evidence,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate visualization');
      }

      const data = await response.json();
      setVisualizationData(data);
      if (data.inputTexts.length > 0) {
        setSelectedInput(data.inputTexts[0].text);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate visualization');
    } finally {
      setLoading(false);
    }
  };

  const getValueColor = (value: number) => {
    const absValue = Math.abs(value);
    if (absValue > 0.5) return 'bg-red-400';
    if (absValue > 0.2) return 'bg-orange-300';
    if (absValue > 0.05) return 'bg-yellow-200';
    return 'bg-gray-100';
  };

  const getSimilarityColor = (similarity: number) => {
    if (similarity >= 0.7) return 'text-green-600 font-bold';
    if (similarity >= 0.5) return 'text-yellow-600';
    if (similarity >= 0.3) return 'text-orange-600';
    return 'text-red-600';
  };

  const selectedComparisons = visualizationData?.comparisons.filter(
    c => c.inputText === selectedInput
  ).sort((a, b) => b.similarity - a.similarity) || [];

  const selectedInputEmbedding = visualizationData?.inputTexts.find(i => i.text === selectedInput);

  return (
    <div className="space-y-6 text-black">
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-2xl font-bold mb-4">Semantic Validation Visualizer</h2>
        <p className="mb-6 text-gray-700">
          This visualizer shows exactly how text gets converted to 384-dimensional vectors (embeddings)
          and how semantic similarity is calculated. See the transformation from words → numbers → similarity scores.
        </p>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-2">Nurse Note</label>
            <textarea
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="Paste nurse note here..."
              className="w-full p-3 border border-gray-300 rounded-md h-32 font-mono text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Model (for Layer 1)</label>
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
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleRunLayer1}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Running...' : 'Step 1: Run Layer 1 Extraction'}
            </button>
            <button
              onClick={handleVisualize}
              disabled={loading || !layer1Evidence}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              Step 2: Generate Visualization
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-md">
            {error}
          </div>
        )}
      </div>

      {layer1Evidence && (
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h3 className="text-xl font-bold mb-3">Layer 1 Evidence</h3>
          <div className="space-y-2">
            {layer1Evidence.injury_mentions.map((mention, idx) => (
              <div key={idx} className="p-2 bg-gray-50 rounded border">
                <span className="font-mono text-sm">"{mention.text}"</span>
                {mention.injury_candidate && (
                  <span className="ml-2 text-green-700">→ {mention.injury_candidate}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {visualizationData && (
        <div className="space-y-6">
          {/* Step 1: Text Input */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-xl font-bold mb-4">Step 1: Input Text from Layer 1</h3>
            <div className="space-y-3">
              {visualizationData.inputTexts.map((input, idx) => (
                <div
                  key={idx}
                  className={`p-3 border-2 rounded cursor-pointer transition-colors ${
                    selectedInput === input.text ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-400'
                  }`}
                  onClick={() => setSelectedInput(input.text)}
                >
                  <div className="font-mono text-sm mb-2">"{input.text}"</div>
                  <div className="text-xs text-gray-600">
                    Will be converted to a {input.embedding.dimension}-dimensional vector
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Step 2: Embedding Visualization */}
          {selectedInputEmbedding && (
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h3 className="text-xl font-bold mb-4">
                Step 2: Text → Embedding Vector (384 Dimensions)
              </h3>
              <div className="mb-4">
                <div className="font-mono text-sm mb-2">Input: "{selectedInputEmbedding.text}"</div>
                <div className="text-sm text-gray-600 mb-4">
                  The Hugging Face model (all-MiniLM-L6-v2) converts this text into a 384-dimensional vector.
                  Each dimension represents a learned feature. Below shows the first 20 dimensions:
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  {selectedInputEmbedding.embedding.sampleValues.map((value, idx) => (
                    <div
                      key={idx}
                      className={`w-8 h-8 ${getValueColor(value)} border border-gray-300 rounded text-xs flex items-center justify-center`}
                      title={`Dimension ${idx + 1}: ${value.toFixed(4)}`}
                    >
                      <span className="text-[8px]">
                        {value > 0 ? '+' : ''}{value.toFixed(2)}
                      </span>
                    </div>
                  ))}
                  <div className="w-8 h-8 bg-gray-200 border border-gray-300 rounded text-xs flex items-center justify-center">
                    ...
                  </div>
                  <div className="w-8 h-8 bg-blue-200 border border-blue-400 rounded text-xs flex items-center justify-center font-semibold">
                    384
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  Each box = one dimension. Color intensity = value magnitude. 
                  Red = high positive, Gray = near zero, Yellow = low positive.
                </div>
              </div>

              <div className="mt-4 p-3 bg-gray-50 rounded">
                <div className="text-sm font-semibold mb-2">Full Vector Properties:</div>
                <div className="grid grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="font-semibold">Dimensions:</span> {selectedInputEmbedding.embedding.dimension}
                  </div>
                  <div>
                    <span className="font-semibold">Min value:</span>{' '}
                    {Math.min(...selectedInputEmbedding.embedding.embedding).toFixed(4)}
                  </div>
                  <div>
                    <span className="font-semibold">Max value:</span>{' '}
                    {Math.max(...selectedInputEmbedding.embedding.embedding).toFixed(4)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Injury Embeddings */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-xl font-bold mb-4">
              Step 3: Allowed Injury Embeddings (Pre-computed)
            </h3>
            <div className="text-sm text-gray-600 mb-4">
              Each allowed injury term (like "pain", "bruise", "unconscious") has also been converted
              to a 384-dimensional vector. These are cached and reused for all comparisons.
            </div>
            <div className="grid grid-cols-3 gap-2">
              {visualizationData.injuryEmbeddings.slice(0, 12).map((injury, idx) => (
                <div key={idx} className="p-2 bg-gray-50 rounded border text-xs">
                  <div className="font-semibold">{injury.injury}</div>
                  <div className="text-gray-500">384-dim vector</div>
                </div>
              ))}
              {visualizationData.injuryEmbeddings.length > 12 && (
                <div className="p-2 bg-gray-100 rounded border text-xs text-center">
                  +{visualizationData.injuryEmbeddings.length - 12} more...
                </div>
              )}
            </div>
          </div>

          {/* Step 4: Comparison & Similarity */}
          {selectedInput && selectedComparisons.length > 0 && (
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h3 className="text-xl font-bold mb-4">
                Step 4: Cosine Similarity Calculation
              </h3>
              <div className="text-sm text-gray-600 mb-4">
                For the selected input "{selectedInput}", we calculate cosine similarity with each injury embedding:
              </div>
              
              <div className="space-y-4">
                {selectedComparisons.slice(0, 10).map((comp, idx) => (
                  <div key={idx} className="border rounded p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-semibold">
                        vs. "{comp.injury}"
                      </div>
                      <div className={`text-lg ${getSimilarityColor(comp.similarity)}`}>
                        {(comp.similarity * 100).toFixed(1)}%
                      </div>
                    </div>
                    
                    <div className="text-xs space-y-1 mt-2 p-2 bg-gray-50 rounded">
                      <div>
                        <span className="font-semibold">Cosine Similarity Formula:</span>
                      </div>
                      <div className="font-mono text-[10px]">
                        similarity = dot_product / (norm_A × norm_B)
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div>Dot Product: <span className="font-mono">{comp.dotProduct.toFixed(4)}</span></div>
                        <div>Norm A: <span className="font-mono">{comp.normA.toFixed(4)}</span></div>
                        <div>Norm B: <span className="font-mono">{comp.normB.toFixed(4)}</span></div>
                        <div>Result: <span className="font-mono font-semibold">{comp.similarity.toFixed(4)}</span></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 p-3 bg-blue-50 rounded">
                <div className="text-sm font-semibold mb-2">Best Match:</div>
                {selectedComparisons[0] && (
                  <div className="text-lg font-bold text-blue-700">
                    "{selectedComparisons[0].injury}" - {(selectedComparisons[0].similarity * 100).toFixed(1)}% similarity
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 5: All Matches Summary */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-xl font-bold mb-4">Step 5: All Matches Summary</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Input Text</th>
                    <th className="text-left p-2">Best Match</th>
                    <th className="text-left p-2">Similarity</th>
                    <th className="text-left p-2">Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {visualizationData.matches
                    .filter((m, idx, arr) => arr.findIndex(x => x.text === m.text && x.rank === 1) === idx)
                    .sort((a, b) => b.similarity - a.similarity)
                    .map((match, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2 font-mono text-xs">"{match.text}"</td>
                        <td className="p-2 font-semibold">{match.matchedInjury}</td>
                        <td className={`p-2 ${getSimilarityColor(match.similarity)}`}>
                          {(match.similarity * 100).toFixed(1)}%
                        </td>
                        <td className="p-2">#{match.rank}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

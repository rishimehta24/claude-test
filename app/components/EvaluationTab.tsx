'use client';

import { useState, useEffect } from 'react';

interface PipelineConfig {
  id: string;
  name: string;
  blocks: Array<{
    id: string;
    type: string;
    config?: any;
  }>;
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

interface BatchEvaluationResponse {
  summary: {
    totalConfigs: number;
    totalNotes: number;
    totalEvaluations: number;
    successfulEvaluations: number;
    failedEvaluations: number;
    totalCost: number;
    averageCost: number;
    averageProcessingTime: number;
  };
  results: EvaluationResult[];
  resultsByConfig: Array<{
    configId: string;
    configName: string;
    results: EvaluationResult[];
  }>;
}

export default function EvaluationTab() {
  const [savedConfigs, setSavedConfigs] = useState<PipelineConfig[]>([]);
  const [selectedConfigs, setSelectedConfigs] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<string[]>(['']);
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [evaluationResults, setEvaluationResults] = useState<BatchEvaluationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load saved configs from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('pipelineConfigs');
    if (saved) {
      try {
        setSavedConfigs(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load saved configs:', e);
      }
    }
  }, []);

  // Watch for changes in localStorage (for cross-tab sync)
  useEffect(() => {
    const handleStorageChange = () => {
      const saved = localStorage.getItem('pipelineConfigs');
      if (saved) {
        try {
          setSavedConfigs(JSON.parse(saved));
        } catch (e) {
          console.error('Failed to load saved configs:', e);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const addNote = () => {
    setNotes([...notes, '']);
  };

  const removeNote = (index: number) => {
    if (notes.length > 1) {
      setNotes(notes.filter((_, i) => i !== index));
    }
  };

  const updateNote = (index: number, value: string) => {
    const newNotes = [...notes];
    newNotes[index] = value;
    setNotes(newNotes);
  };

  const toggleConfig = (configId: string) => {
    const newSelected = new Set(selectedConfigs);
    if (newSelected.has(configId)) {
      newSelected.delete(configId);
    } else {
      newSelected.add(configId);
    }
    setSelectedConfigs(newSelected);
  };

  const runEvaluation = async () => {
    if (selectedConfigs.size === 0) {
      setError('Please select at least one pipeline config');
      return;
    }

    const validNotes = notes.filter(n => n.trim().length > 0);
    if (validNotes.length === 0) {
      setError('Please add at least one note to evaluate');
      return;
    }

    setLoading(true);
    setError(null);
    setEvaluationResults(null);

    try {
      const configsToEvaluate = savedConfigs.filter(c => selectedConfigs.has(c.id));
      
      const response = await fetch('/api/pipeline/batch-evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configs: configsToEvaluate,
          notes: validNotes,
          apiKey: apiKey || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to run evaluation');
      }

      const data = await response.json();
      setEvaluationResults(data);
    } catch (err: any) {
      setError(err.message || 'Failed to run evaluation');
    } finally {
      setLoading(false);
    }
  };

  const exportReport = () => {
    if (!evaluationResults) return;

    // Create CSV report
    const headers = ['Config Name', 'Note Index', 'Note Preview', 'Success', 'Injuries Found', 'Cost', 'Processing Time (ms)', 'Error'];
    const rows = evaluationResults.results.map(result => [
      result.configName,
      result.noteIndex + 1,
      `"${result.noteContent.replace(/"/g, '""')}"`,
      result.success ? 'Yes' : 'No',
      result.finalInjuries ? result.finalInjuries.length : 0,
      result.cost.toFixed(4),
      result.processingTime,
      result.error || '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `pipeline-evaluation-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 text-black">
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-2xl font-bold mb-4">Pipeline Evaluation</h2>
        <p className="mb-6 text-gray-700">
          Select saved pipeline configurations and evaluate them against multiple notes. Generate detailed comparison reports.
        </p>

        {/* Saved Configs Selection */}
        <div className="mb-6">
          <h3 className="font-semibold mb-3">Select Pipeline Configs</h3>
          {savedConfigs.length === 0 ? (
            <div className="p-4 border-2 border-dashed border-gray-300 rounded text-center text-gray-500">
              No saved pipeline configs found. Save configs in the Pipeline Builder tab first.
            </div>
          ) : (
            <div className="space-y-2">
              {savedConfigs.map((config) => (
                <label
                  key={config.id}
                  className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedConfigs.has(config.id)}
                    onChange={() => toggleConfig(config.id)}
                    className="w-4 h-4 text-blue-600"
                  />
                  <div className="flex-1">
                    <div className="font-semibold">{config.name}</div>
                    <div className="text-sm text-gray-500">
                      {config.blocks.length} block{config.blocks.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Notes Input */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Evaluation Notes</h3>
            <button
              onClick={addNote}
              className="px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
            >
              + Add Note
            </button>
          </div>
          <div className="space-y-2">
            {notes.map((note, index) => (
              <div key={index} className="flex gap-2">
                <div className="flex-1">
                  <textarea
                    value={note}
                    onChange={(e) => updateNote(index, e.target.value)}
                    placeholder={`Note ${index + 1}...`}
                    className="w-full p-3 border border-gray-300 rounded-md h-24 font-mono text-sm"
                  />
                </div>
                {notes.length > 1 && (
                  <button
                    onClick={() => removeNote(index)}
                    className="px-3 py-2 bg-red-200 text-red-800 rounded-md hover:bg-red-300 text-sm"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* API Key */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">
            API Key (Optional - uses env var if not provided)
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Leave empty to use environment variable"
            className="w-full p-2 border border-gray-300 rounded-md"
          />
        </div>

        {/* Run Button */}
        <div className="flex gap-3">
          <button
            onClick={runEvaluation}
            disabled={loading || selectedConfigs.size === 0}
            className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Running Evaluation...' : 'Run Evaluation'}
          </button>
          {evaluationResults && (
            <button
              onClick={exportReport}
              className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
            >
              Export Report (CSV)
            </button>
          )}
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-md">
            {error}
          </div>
        )}
      </div>

      {/* Results */}
      {evaluationResults && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-xl font-bold mb-4">Evaluation Summary</h3>
            <div className="grid grid-cols-4 gap-4">
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="text-sm text-gray-600 mb-1">Total Evaluations</div>
                <div className="text-2xl font-bold text-blue-900">
                  {evaluationResults.summary.totalEvaluations}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {evaluationResults.summary.totalConfigs} configs × {evaluationResults.summary.totalNotes} notes
                </div>
              </div>
              <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                <div className="text-sm text-gray-600 mb-1">Successful</div>
                <div className="text-2xl font-bold text-green-900">
                  {evaluationResults.summary.successfulEvaluations}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {(evaluationResults.summary.successfulEvaluations / evaluationResults.summary.totalEvaluations * 100).toFixed(1)}% success rate
                </div>
              </div>
              <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                <div className="text-sm text-gray-600 mb-1">Total Cost</div>
                <div className="text-2xl font-bold text-purple-900">
                  ${evaluationResults.summary.totalCost.toFixed(4)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Avg: ${evaluationResults.summary.averageCost.toFixed(4)} per eval
                </div>
              </div>
              <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                <div className="text-sm text-gray-600 mb-1">Avg Time</div>
                <div className="text-2xl font-bold text-orange-900">
                  {(evaluationResults.summary.averageProcessingTime / 1000).toFixed(2)}s
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  per evaluation
                </div>
              </div>
            </div>
          </div>

          {/* Results by Config */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-xl font-bold mb-4">Results by Pipeline Config</h3>
            <div className="space-y-6">
              {evaluationResults.resultsByConfig.map((configGroup) => (
                <div key={configGroup.configId} className="border rounded-lg p-4">
                  <h4 className="font-semibold text-lg mb-3">{configGroup.configName}</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50">
                          <th className="text-left p-2">Note #</th>
                          <th className="text-left p-2">Note Preview</th>
                          <th className="text-center p-2">Status</th>
                          <th className="text-right p-2">Injuries</th>
                          <th className="text-right p-2">Cost</th>
                          <th className="text-right p-2">Time</th>
                          <th className="text-left p-2">Injuries List</th>
                        </tr>
                      </thead>
                      <tbody>
                        {configGroup.results.map((result, idx) => (
                          <tr key={idx} className={`border-b ${result.success ? '' : 'bg-red-50'}`}>
                            <td className="p-2 font-mono">{result.noteIndex + 1}</td>
                            <td className="p-2 font-mono text-xs max-w-xs truncate">
                              {result.noteContent}
                            </td>
                            <td className="p-2 text-center">
                              {result.success ? (
                                <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                                  ✓ Success
                                </span>
                              ) : (
                                <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs">
                                  ✗ Failed
                                </span>
                              )}
                            </td>
                            <td className="p-2 text-right font-mono">
                              {result.finalInjuries ? result.finalInjuries.length : '-'}
                            </td>
                            <td className="p-2 text-right font-mono">
                              ${result.cost.toFixed(4)}
                            </td>
                            <td className="p-2 text-right font-mono">
                              {(result.processingTime / 1000).toFixed(2)}s
                            </td>
                            <td className="p-2 text-xs">
                              {result.finalInjuries && result.finalInjuries.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {result.finalInjuries.map((inj, i) => (
                                    <span
                                      key={i}
                                      className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs"
                                    >
                                      {inj.matched_injury}
                                    </span>
                                  ))}
                                </div>
                              ) : result.error ? (
                                <span className="text-red-600">{result.error}</span>
                              ) : (
                                <span className="text-gray-400">No injuries</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50 font-semibold">
                        <tr>
                          <td colSpan={3} className="p-2">Total</td>
                          <td className="p-2 text-right">
                            {configGroup.results
                              .filter(r => r.success && r.finalInjuries)
                              .reduce((sum, r) => sum + (r.finalInjuries?.length || 0), 0)}
                          </td>
                          <td className="p-2 text-right">
                            ${configGroup.results.reduce((sum, r) => sum + r.cost, 0).toFixed(4)}
                          </td>
                          <td className="p-2 text-right">
                            {(configGroup.results.reduce((sum, r) => sum + r.processingTime, 0) / 1000).toFixed(2)}s
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Comparison Matrix */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-xl font-bold mb-4">Injury Detection Comparison Matrix</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left p-2 border">Note #</th>
                    {evaluationResults.resultsByConfig.map((config) => (
                      <th key={config.configId} className="text-center p-2 border">
                        {config.configName}
                        <div className="text-xs font-normal text-gray-500">
                          Cost: ${config.results.reduce((sum, r) => sum + r.cost, 0).toFixed(4)}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: evaluationResults.summary.totalNotes }).map((_, noteIdx) => (
                    <tr key={noteIdx} className="border-b">
                      <td className="p-2 border font-mono font-semibold">{noteIdx + 1}</td>
                      {evaluationResults.resultsByConfig.map((config) => {
                        const result = config.results.find(r => r.noteIndex === noteIdx);
                        return (
                          <td key={config.configId} className="p-2 border text-center">
                            {result ? (
                              <div className="space-y-1">
                                <div className={`font-semibold ${
                                  result.success ? 'text-green-700' : 'text-red-700'
                                }`}>
                                  {result.success ? '✓' : '✗'}
                                </div>
                                <div className="text-xs text-gray-600">
                                  {result.finalInjuries ? result.finalInjuries.length : 0} injuries
                                </div>
                                <div className="text-xs font-mono">
                                  ${result.cost.toFixed(4)}
                                </div>
                                {result.finalInjuries && result.finalInjuries.length > 0 && (
                                  <div className="text-xs mt-1">
                                    {result.finalInjuries.map((inj, i) => (
                                      <span
                                        key={i}
                                        className="inline-block px-1 py-0.5 bg-blue-100 text-blue-800 rounded mr-1 mb-1"
                                      >
                                        {inj.matched_injury}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                        );
                      })}
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

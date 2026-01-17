'use client';

import { useState } from 'react';
import { ALL_MODELS, ModelInfo } from '@/lib/constants';

interface ModelResult {
  model: string;
  provider?: string;
  success: boolean;
  response: any;
  rawResponse: string | null;
  error?: string;
}

interface NoteResult {
  noteIndex: number;
  noteContent: string;
  results: ModelResult[];
}

export default function BulkTestTab() {
  const [notes, setNotes] = useState<string[]>(['', '', '', '', '']);
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<NoteResult[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const formatResponseForCSV = (response: any): string => {
    if (response === null || response === undefined) {
      return '';
    }
    if (typeof response === 'string') {
      return response.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '');
    }
    const jsonStr = JSON.stringify(response);
    return jsonStr.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '');
  };

  const formatResponse = (response: any): string => {
    if (response === null || response === undefined) {
      return 'No response';
    }
    if (typeof response === 'string') {
      return response;
    }
    if (Array.isArray(response)) {
      if (response.length === 0) {
        return '[]';
      }
      return JSON.stringify(response, null, 2);
    }
    return JSON.stringify(response, null, 2);
  };

  const handleTest = async () => {
    const validNotes = notes.filter(n => n.trim() !== '');
    if (validNotes.length === 0) {
      alert('Please enter at least one note');
      return;
    }

    setTesting(true);
    setResults([]);
    const totalRequests = validNotes.length * ALL_MODELS.length;
    setProgress({ current: 0, total: totalRequests });

    const allResults: NoteResult[] = [];

    try {
      for (let noteIndex = 0; noteIndex < validNotes.length; noteIndex++) {
        const noteContent = validNotes[noteIndex];
        const modelResults: ModelResult[] = [];

        // Test each model individually using R&D two-layer pipeline
        for (let modelIndex = 0; modelIndex < ALL_MODELS.length; modelIndex++) {
          const modelInfo = ALL_MODELS[modelIndex];
          
          try {
            const response = await fetch('/api/rnd/extract', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                noteContent,
                config: {
                  model: modelInfo.id,
                  temperature: 0,
                  maxTokens: 2000,
                  useSectionRecognizer: false,
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
              // R&D pipeline returns finalInjuries in the same format
              modelResults.push({
                model: modelInfo.id,
                provider: modelInfo.provider,
                success: !data.result.error,
                response: data.result.finalInjuries || [],
                rawResponse: data.result.rawLayer1Response || null,
                error: data.result.error || undefined,
              });
            } else {
              modelResults.push({
                model: modelInfo.id,
                provider: modelInfo.provider,
                success: false,
                response: null,
                rawResponse: null,
                error: data.error || 'Unknown error',
              });
            }
          } catch (error: any) {
            modelResults.push({
              model: modelInfo.id,
              provider: modelInfo.provider,
              success: false,
              response: null,
              rawResponse: null,
              error: error.message || 'Failed to test model',
            });
          }

          // Update progress
          const currentProgress = (noteIndex * ALL_MODELS.length) + (modelIndex + 1);
          setProgress({ current: currentProgress, total: totalRequests });
        }

        allResults.push({
          noteIndex: noteIndex + 1,
          noteContent,
          results: modelResults,
        });

        setResults([...allResults]);

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } catch (error: any) {
      console.error('Bulk test error:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setTesting(false);
      setProgress({ current: 0, total: 0 });
    }
  };

  const exportReport = () => {
    if (results.length === 0) {
      alert('No results to export');
      return;
    }

    // Create CSV content
    const csvRows: any[] = [];

    // Header row
    const headerRow: Record<string, string> = {
      'Note #': '',
      'Note Content': '',
    };
    ALL_MODELS.forEach((modelInfo: ModelInfo) => {
      headerRow[modelInfo.id] = '';
    });
    csvRows.push(headerRow);

    // Data rows
    results.forEach((noteResult) => {
      const modelResultsMap: Record<string, string> = {};
      noteResult.results.forEach((result: ModelResult) => {
        if (result.success) {
          modelResultsMap[result.model] = formatResponseForCSV(result.response);
        } else {
          modelResultsMap[result.model] = `ERROR: ${result.error || 'Unknown error'}`;
        }
      });

      const row: Record<string, string> = {
        'Note #': `Note ${noteResult.noteIndex}`,
        'Note Content': formatResponseForCSV(noteResult.noteContent),
      };

      ALL_MODELS.forEach((modelInfo: ModelInfo) => {
        row[modelInfo.id] = modelResultsMap[modelInfo.id] || '';
      });

      csvRows.push(row);
    });

    // Generate CSV
    const headers = Object.keys(csvRows[0]);
    const csvContent = [
      headers.map(h => `"${h}"`).join(','),
      ...csvRows.map(row => 
        headers.map(header => `"${row[header] || ''}"`).join(',')
      )
    ].join('\n');

    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `bulk-test-report-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const updateNote = (index: number, content: string) => {
    const newNotes = [...notes];
    newNotes[index] = content;
    setNotes(newNotes);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
        <h2 className="text-2xl font-bold text-black mb-4">
          Bulk Model Testing (Two-Layer R&D Pipeline)
        </h2>
        <p className="text-black mb-6">
          Test up to 5 nurse notes across all {ALL_MODELS.length} models using the <strong>Two-Layer R&D Pipeline</strong>:
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li><strong>Layer 1 (LLM)</strong>: Extracts structured evidence from each note</li>
            <li><strong>Layer 2 (Deterministic Code)</strong>: Evaluates evidence to produce final injuries</li>
          </ul>
          <span className="text-sm text-gray-600 mt-2 block">Results will be exported as a CSV report showing final injuries from Layer 2 evaluation.</span>
        </p>

        {/* Note Inputs */}
        <div className="space-y-4 mb-6">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index}>
              <label className="block text-sm font-medium text-black mb-2">
                Note {index + 1}
              </label>
              <textarea
                value={notes[index] || ''}
                onChange={(e) => updateNote(index, e.target.value)}
                placeholder={`Enter nurse note ${index + 1} here...`}
                className="w-full h-32 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                disabled={testing}
              />
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-4 items-center">
          <button
            onClick={handleTest}
            disabled={testing || notes.filter(n => n.trim() !== '').length === 0}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-semibold"
          >
            {testing ? `Testing... ${progress.current}/${progress.total}` : 'Run All Models on All Notes'}
          </button>

          {results.length > 0 && (
            <button
              onClick={exportReport}
              className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold"
            >
              Export Report (CSV)
            </button>
          )}
        </div>

        {/* Progress Bar */}
        {testing && (
          <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-black">
                  Testing {notes.filter(n => n.trim() !== '').length} notes across {ALL_MODELS.length} models...
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  Progress: {progress.current} of {progress.total} requests completed
                </div>
                <div className="mt-2 w-full bg-blue-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Results Summary */}
      {results.length > 0 && !testing && (
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
          <h3 className="text-xl font-bold text-black mb-4">
            Results Summary
          </h3>
          <div className="space-y-4">
            {results.map((noteResult) => (
              <div key={noteResult.noteIndex} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <h4 className="font-semibold text-black mb-2">Note {noteResult.noteIndex}</h4>
                <div className="mb-3 bg-white p-3 rounded border border-gray-200 text-sm text-black whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {noteResult.noteContent.substring(0, 200)}{noteResult.noteContent.length > 200 ? '...' : ''}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
                  {noteResult.results.map((result: ModelResult) => (
                    <div
                      key={result.model}
                      className={`p-2 rounded border ${
                        result.success
                          ? 'bg-green-50 border-green-200'
                          : 'bg-red-50 border-red-200'
                      }`}
                    >
                      <div className="font-semibold text-black truncate" title={result.model}>
                        {result.model.split('-')[0]}
                      </div>
                      <div className={`text-xs mt-1 ${result.success ? 'text-green-700' : 'text-red-700'}`}>
                        {result.success ? '✓' : '✗'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

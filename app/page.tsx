'use client';

import { useState, useEffect } from 'react';
import { ALL_MODELS, ModelInfo } from '@/lib/constants';
import EvaluationTab from './components/EvaluationTab';
import SemanticVisualizerTab from './components/SemanticVisualizerTab';
import CostCalculatorTab from './components/CostCalculatorTab';
import PipelineBuilderTab from './components/PipelineBuilderTab';

interface Evaluation {
  accuracy: string;
  issues: string;
  confidence: string;
  feedback: string;
}

interface Note {
  noteType: string;
  noteContent: string;
  incidentDate: string;
  timestamp?: string;
  originalResponse: string;
  originalModel: string;
  detectedInjuries?: string;
  evaluation?: Evaluation;
}

interface Resident {
  residentName: string;
  notes: Note[];
}

interface ModelResult {
  model: string;
  provider?: string;
  success: boolean;
  response: any;
  rawResponse: string | null;
  error?: string;
}

interface ComparisonResult {
  noteKey?: string | number;
  noteIndex?: number;
  results: ModelResult[];
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'comparison' | 'evaluation' | 'visualizer' | 'cost' | 'pipeline'>('comparison');
  const [residents, setResidents] = useState<Resident[]>([]);
  const [expandedResidents, setExpandedResidents] = useState<Set<string>>(new Set());
  const [comparisons, setComparisons] = useState<Record<string, Record<string | number, ComparisonResult>>>({});
  const [loading, setLoading] = useState<Record<string, Record<string | number, boolean>>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    // Load data from the extracted JSON file
    fetch('/notes-data.json')
      .then(res => res.json())
      .then(data => setResidents(data))
      .catch(err => {
        console.error('Error loading notes data:', err);
        // If file doesn't exist, show message
        alert('Please run the data extraction script first: npm run extract-data');
      });
  }, []);

  const toggleResident = (residentName: string) => {
    const newExpanded = new Set(expandedResidents);
    if (newExpanded.has(residentName)) {
      newExpanded.delete(residentName);
    } else {
      newExpanded.add(residentName);
    }
    setExpandedResidents(newExpanded);
  };

  const compareModels = async (residentName: string, noteKey: string | number, noteContent: string) => {
    const loadingKey = `${residentName}-${noteKey}`;
    
    // Set loading state
    setLoading(prev => ({
      ...prev,
      [residentName]: {
        ...prev[residentName],
        [noteKey]: true,
      },
    }));

    try {
      const response = await fetch('/api/compare', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          noteContent,
          models: ALL_MODELS.map(m => m.id),
        }),
      });

      const data = await response.json();

      setComparisons(prev => ({
        ...prev,
        [residentName]: {
          ...prev[residentName],
          [noteKey]: {
            noteKey,
            results: data.results,
          },
        },
      }));
    } catch (error: any) {
      console.error('Error comparing models:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(prev => ({
        ...prev,
        [residentName]: {
          ...prev[residentName],
          [noteKey]: false,
        },
      }));
    }
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

  const getGroundTruthMatch = (result: ModelResult, evaluation: Evaluation | undefined, originalResponse: string): string => {
    if (!evaluation || !evaluation.accuracy || !result.success) return 'unknown';
    
    const isOriginalCorrect = evaluation.accuracy.toLowerCase().includes('correct') && 
                              !evaluation.accuracy.toLowerCase().includes('incorrect');
    
    // If original was correct, check if this model produces similar output
    if (isOriginalCorrect) {
      const resultStr = JSON.stringify(result.response);
      const originalStr = JSON.stringify(originalResponse);
      // Simple similarity check - in production, you'd want more sophisticated comparison
      if (resultStr === originalStr || resultStr.includes(originalStr) || originalStr.includes(resultStr)) {
        return 'matches';
      }
      return 'different';
    } else {
      // If original was incorrect, different outputs might be better
      const resultStr = JSON.stringify(result.response);
      const originalStr = JSON.stringify(originalResponse);
      if (resultStr !== originalStr && !resultStr.includes(originalStr) && !originalStr.includes(resultStr)) {
        return 'potentially_better';
      }
      return 'same_as_incorrect';
    }
  };

  const formatResponseForCSV = (response: any): string => {
    if (response === null || response === undefined) {
      return '';
    }
    if (typeof response === 'string') {
      // Escape quotes and newlines for CSV
      return response.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '');
    }
    // Convert to JSON string and escape for CSV
    const jsonStr = JSON.stringify(response);
    return jsonStr.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '');
  };

  const processIncorrectEvaluations = async () => {
    // Find all notes with incorrect evaluations
    const incorrectNotes: Array<{ resident: string; note: Note; index: number }> = [];
    
    residents.forEach(resident => {
      resident.notes.forEach((note, index) => {
        const acc = note.evaluation?.accuracy || '';
        if (acc && acc.toLowerCase().includes('incorrect')) {
          incorrectNotes.push({ resident: resident.residentName, note, index });
        }
      });
    });

    if (incorrectNotes.length === 0) {
      alert('No notes with incorrect evaluations found.');
      return;
    }

    const confirmed = confirm(
      `Found ${incorrectNotes.length} notes with incorrect evaluations. This will test all ${ALL_MODELS.length} models for each note. Continue?`
    );

    if (!confirmed) return;

    setBulkProcessing(true);
    setBulkProgress({ current: 0, total: incorrectNotes.length });

    const csvRows: any[] = [];

    try {
      for (let i = 0; i < incorrectNotes.length; i++) {
        const { resident, note } = incorrectNotes[i];
        setBulkProgress({ current: i + 1, total: incorrectNotes.length });

        // Test all models for this note
        const response = await fetch('/api/compare', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            noteContent: note.noteContent,
            models: ALL_MODELS.map(m => m.id),
          }),
        });

        const data = await response.json();
        const results = data.results;

        // Create a map of model results
        const modelResults: Record<string, string> = {};
        results.forEach((result: ModelResult) => {
          if (result.success) {
            modelResults[result.model] = formatResponseForCSV(result.response);
          } else {
            modelResults[result.model] = `ERROR: ${result.error || 'Unknown error'}`;
          }
        });

        // Build CSV row with dynamic columns for all models
        const groundTruthEval = note.evaluation 
          ? `Accuracy: ${note.evaluation.accuracy} | Issues: ${note.evaluation.issues || 'None'} | Confidence: ${note.evaluation.confidence || 'N/A'} | Feedback: ${note.evaluation.feedback || ''}`
          : '';

        // Build row with all model columns
        const row: Record<string, string> = {
          'Input Prompt': formatResponseForCSV(note.noteContent),
          'Original Response (claude-3-haiku)': formatResponseForCSV(note.originalResponse),
          'Ground Truth Evaluation': formatResponseForCSV(groundTruthEval),
        };

        // Add all models as columns
        ALL_MODELS.forEach((modelInfo: ModelInfo) => {
          row[modelInfo.id] = modelResults[modelInfo.id] || '';
        });

        csvRows.push(row);

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }

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
      link.setAttribute('download', `incorrect-evaluations-comparison-${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      alert(`Successfully processed ${incorrectNotes.length} notes and downloaded CSV!`);
    } catch (error: any) {
      console.error('Error processing incorrect evaluations:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setBulkProcessing(false);
      setBulkProgress({ current: 0, total: 0 });
    }
  };

  const filteredResidents = residents.filter(resident =>
    resident.residentName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Tab Navigation */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2">
                Claude Model Comparison
              </h1>
              <p className="text-gray-600">
                Compare outputs from different Claude models for medical note analysis
              </p>
            </div>
            {activeTab === 'comparison' && (
            <button
              onClick={processIncorrectEvaluations}
              disabled={bulkProcessing}
              className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold rounded-lg shadow-lg transition-colors"
              title="Process all notes with incorrect evaluations and generate CSV"
            >
              <span className="text-2xl">☢️</span>
              <span>{bulkProcessing ? `Processing... ${bulkProgress.current}/${bulkProgress.total}` : 'Run Bulk Analysis'}</span>
            </button>
            )}
          </div>
          
          {/* Tabs */}
          <div className="flex gap-4 border-b border-gray-200 mb-6">
            <button
              onClick={() => setActiveTab('comparison')}
              className={`px-6 py-3 font-semibold transition-colors ${
                activeTab === 'comparison'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Model Comparison
            </button>
            <button
              onClick={() => setActiveTab('evaluation')}
              className={`px-6 py-3 font-semibold transition-colors ${
                activeTab === 'evaluation'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Evaluation
            </button>
            <button
              onClick={() => setActiveTab('visualizer')}
              className={`px-6 py-3 font-semibold transition-colors ${
                activeTab === 'visualizer'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Semantic Visualizer
            </button>
            <button
              onClick={() => setActiveTab('cost')}
              className={`px-6 py-3 font-semibold transition-colors ${
                activeTab === 'cost'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Cost Calculator
            </button>
            <button
              onClick={() => setActiveTab('pipeline')}
              className={`px-6 py-3 font-semibold transition-colors ${
                activeTab === 'pipeline'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Pipeline Builder
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'evaluation' ? (
          <EvaluationTab />
        ) : activeTab === 'visualizer' ? (
          <SemanticVisualizerTab />
        ) : activeTab === 'cost' ? (
          <CostCalculatorTab />
        ) : activeTab === 'pipeline' ? (
          <PipelineBuilderTab />
        ) : (
          <>
          {bulkProcessing && (
            <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-blue-900">
                    Processing incorrect evaluations...
                  </div>
                  <div className="text-xs text-blue-700 mt-1">
                    Progress: {bulkProgress.current} of {bulkProgress.total} notes completed
                  </div>
                  <div className="mt-2 w-full bg-blue-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          )}

        <div className="mb-6">
          <input
            type="text"
            placeholder="Search by resident name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="space-y-4">
          {filteredResidents.map((resident) => {
            const isExpanded = expandedResidents.has(resident.residentName);
            const residentComparisons = comparisons[resident.residentName] || {};
            const residentLoading = loading[resident.residentName] || {};
            
            // Check if any note has an incorrect evaluation
            const hasIncorrectEval = resident.notes.some(note => {
              const acc = note.evaluation?.accuracy || '';
              return acc && acc.toLowerCase().includes('incorrect');
            });

            // Collect unique injuries from all notes
            const injurySet = new Set<string>();
            resident.notes.forEach(note => {
              const injuries = note.detectedInjuries;
              if (injuries && injuries !== 'No Injury' && injuries !== 'No Head Injury') {
                // Handle comma-separated injuries
                injuries.split(',').forEach(inj => {
                  const trimmed = inj.trim();
                  if (trimmed) injurySet.add(trimmed);
                });
              }
            });
            const uniqueInjuries = Array.from(injurySet).sort();

            return (
              <div
                key={resident.residentName}
                className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden"
              >
                <button
                  onClick={() => toggleResident(resident.residentName)}
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-4 flex-1">
                    <div className="flex-1">
                      <div className="text-lg font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
                        {resident.residentName}
                        {hasIncorrectEval && (
                          <span className="text-yellow-600 text-sm font-normal flex items-center gap-1">
                            ⚠️ Has Incorrect Evaluations
                          </span>
                        )}
                      </div>
                      {uniqueInjuries.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {uniqueInjuries.map((injury, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium"
                            >
                              {injury}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-sm text-gray-500">
                      {resident.notes.length} note{resident.notes.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div className="text-gray-400">
                    {isExpanded ? '▼' : '▶'}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-200 p-6 space-y-6">
                    {resident.notes
                      .sort((a, b) => {
                        // Sort: runs with evaluation first, then by timestamp (newest first)
                        const aHasEval = a.evaluation && a.evaluation.accuracy && a.evaluation.accuracy.trim() !== '';
                        const bHasEval = b.evaluation && b.evaluation.accuracy && b.evaluation.accuracy.trim() !== '';
                        if (aHasEval && !bHasEval) return -1;
                        if (!aHasEval && bHasEval) return 1;
                        // If both have or don't have evaluation, sort by timestamp
                        if (a.timestamp && b.timestamp) {
                          return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
                        }
                        return 0;
                      })
                      .map((note, noteIndex) => {
                      // Create a unique key for this note/run combination
                      const noteKey = `${note.noteContent}-${note.timestamp || noteIndex}-${note.originalResponse}`;
                      const comparison = residentComparisons[noteKey] || residentComparisons[noteIndex];
                      const isLoading = residentLoading[noteKey] || residentLoading[noteIndex];

                      // Count how many runs have the same note content
                      const runsWithSameContent = resident.notes.filter(n => n.noteContent === note.noteContent).length;
                      const runNumber = resident.notes.filter((n, idx) => 
                        n.noteContent === note.noteContent && idx <= noteIndex
                      ).length;

                      return (
                        <div
                          key={noteKey}
                          className="border border-gray-200 rounded-lg p-4 bg-gray-50"
                        >
                          <div className="mb-4">
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <h3 className="font-semibold text-gray-900">
                                  {note.noteType}
                                </h3>
                                {runsWithSameContent > 1 && (
                                  <div className="text-xs text-gray-500 mt-1">
                                    Run {runNumber} of {runsWithSameContent} for this note
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={() => compareModels(resident.residentName, noteKey, note.noteContent)}
                                disabled={isLoading}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                              >
                                {isLoading ? 'Testing...' : comparison ? 'Re-test Models' : 'Test All Models'}
                              </button>
                            </div>
                            <div className="text-sm text-gray-600 mb-2 space-x-4">
                              <span><strong>Incident Date:</strong> {note.incidentDate}</span>
                              {note.timestamp && (
                                <span><strong>Run Timestamp:</strong> {new Date(note.timestamp).toLocaleString()}</span>
                              )}
                            </div>
                            <div className="bg-white p-3 rounded border border-gray-200 mb-2">
                              <div className="text-xs font-semibold text-gray-500 mb-1">Note Content:</div>
                              <div className="text-sm text-gray-800 whitespace-pre-wrap max-h-40 overflow-y-auto">
                                {note.noteContent}
                              </div>
                            </div>
                            {note.originalResponse && (
                              <div className="bg-yellow-50 p-3 rounded border border-yellow-200 mb-2">
                                <div className="text-xs font-semibold text-gray-500 mb-1">
                                  Original Response ({note.originalModel}):
                                </div>
                                <div className="text-sm text-gray-800">
                                  {(() => {
                                    const response = note.originalResponse;
                                    if (typeof response === 'string' && response.trim().startsWith('[')) {
                                      try {
                                        const parsed = JSON.parse(response);
                                        return <pre className="font-mono text-xs bg-white p-2 rounded border border-gray-200 overflow-x-auto">{JSON.stringify(parsed, null, 2)}</pre>;
                                      } catch (e) {
                                        return <pre className="font-mono text-xs bg-white p-2 rounded border border-gray-200 overflow-x-auto">{response}</pre>;
                                      }
                                    }
                                    return <div className="whitespace-pre-wrap">{response}</div>;
                                  })()}
                                </div>
                              </div>
                            )}
                            {note.detectedInjuries && (
                              <div className="bg-blue-50 p-3 rounded border border-blue-200 mb-2">
                                <div className="text-xs font-semibold text-gray-500 mb-1">
                                  Detected Injuries:
                                </div>
                                <div className="text-sm text-gray-800">
                                  {note.detectedInjuries}
                                </div>
                              </div>
                            )}
                            {note.evaluation && note.evaluation.accuracy && (
                              <div className="bg-green-50 p-4 rounded border-2 border-green-300 mb-2">
                                <div className="flex items-center gap-2 mb-3">
                                  <span className="text-lg">✅</span>
                                  <div className="text-sm font-bold text-gray-900">
                                    Ground Truth Evaluation (AI Assessment)
                                  </div>
                                </div>
                                <div className="grid grid-cols-3 gap-3 mb-3">
                                  <div>
                                    <div className="text-xs font-semibold text-gray-600 mb-1">Accuracy</div>
                                    <div className={`text-sm font-semibold ${
                                      note.evaluation.accuracy.toLowerCase().includes('correct') && 
                                      !note.evaluation.accuracy.toLowerCase().includes('incorrect')
                                        ? 'text-green-700' 
                                        : 'text-red-700'
                                    }`}>
                                      {note.evaluation.accuracy}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-xs font-semibold text-gray-600 mb-1">Issues</div>
                                    <div className="text-sm text-gray-800">
                                      {note.evaluation.issues || 'None'}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-xs font-semibold text-gray-600 mb-1">Confidence</div>
                                    <div className="text-sm text-gray-800">
                                      {note.evaluation.confidence || 'N/A'}
                                    </div>
                                  </div>
                                </div>
                                {note.evaluation.feedback && (
                                  <div className="mt-2 pt-2 border-t border-green-200">
                                    <div className="text-xs font-semibold text-gray-600 mb-1">Explanation</div>
                                    <div className="text-sm text-gray-800 whitespace-pre-wrap">
                                      {note.evaluation.feedback}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {isLoading && (
                            <div className="text-center py-8 text-gray-500">
                              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                              <div className="mt-2">Testing all models...</div>
                            </div>
                          )}

                          {comparison && !isLoading && (
                            <div className="mt-4">
                              <h4 className="font-semibold text-gray-900 mb-3">
                                Model Comparison Results:
                              </h4>
                              <div className="overflow-x-auto">
                                <table className="w-full border-collapse bg-white rounded-lg overflow-hidden">
                                  <thead>
                                    <tr className="bg-gray-100">
                                      <th className="border border-gray-300 px-4 py-3 text-left font-semibold text-gray-700">
                                        Model
                                      </th>
                                      <th className="border border-gray-300 px-4 py-3 text-left font-semibold text-gray-700">
                                        Status
                                      </th>
                                      {note.evaluation && note.evaluation.accuracy && (
                                        <th className="border border-gray-300 px-4 py-3 text-left font-semibold text-gray-700">
                                          Matches Ground Truth
                                        </th>
                                      )}
                                      <th className="border border-gray-300 px-4 py-3 text-left font-semibold text-gray-700">
                                        Response
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {comparison.results.map((result, idx) => {
                                      const gtMatch = getGroundTruthMatch(result, note.evaluation, note.originalResponse);
                                      const getMatchDisplay = () => {
                                        if (!note.evaluation || !note.evaluation.accuracy || !result.success) {
                                          return <span className="text-xs text-gray-400">N/A</span>;
                                        }
                                        const isOriginalCorrect = note.evaluation.accuracy.toLowerCase().includes('correct') && 
                                                                  !note.evaluation.accuracy.toLowerCase().includes('incorrect');
                                        
                                        if (isOriginalCorrect) {
                                          if (gtMatch === 'matches') {
                                            return (
                                              <span className="px-2 py-1 bg-green-200 text-green-900 rounded text-xs font-semibold flex items-center gap-1">
                                                <span>✅</span> Matches
                                              </span>
                                            );
                                          }
                                          return (
                                            <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs font-semibold">
                                              ⚠️ Different
                                            </span>
                                          );
                                        } else {
                                          if (gtMatch === 'potentially_better') {
                                            return (
                                              <span className="px-2 py-1 bg-blue-200 text-blue-900 rounded text-xs font-semibold">
                                                💡 Different (may be better)
                                              </span>
                                            );
                                          }
                                          return (
                                            <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-semibold">
                                              ❌ Same issue
                                            </span>
                                          );
                                        }
                                      };
                                      
                                      return (
                                        <tr
                                          key={idx}
                                          className={
                                            result.success 
                                              ? gtMatch === 'matches' 
                                                ? 'hover:bg-green-50 bg-green-50/30' 
                                                : gtMatch === 'potentially_better'
                                                ? 'hover:bg-blue-50 bg-blue-50/30'
                                                : 'hover:bg-gray-50'
                                              : 'bg-red-50'
                                          }
                                        >
                                          <td className="border border-gray-300 px-4 py-3">
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <span className="font-mono text-sm text-gray-900">{result.model}</span>
                                              {result.provider && (
                                                <span className={`px-2 py-1 text-xs font-semibold rounded ${
                                                  result.provider === 'anthropic' ? 'bg-purple-100 text-purple-800' :
                                                  result.provider === 'openai' ? 'bg-green-100 text-green-800' :
                                                  result.provider === 'google' ? 'bg-blue-100 text-blue-800' :
                                                  'bg-gray-100 text-gray-800'
                                                }`}>
                                                  {result.provider.toUpperCase()}
                                                </span>
                                              )}
                                            {result.model === note.originalModel && (
                                              <span className="ml-2 text-xs text-gray-500">(Original)</span>
                                            )}
                                            </div>
                                          </td>
                                          <td className="border border-gray-300 px-4 py-3">
                                            {result.success ? (
                                              <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-semibold">
                                                Success
                                              </span>
                                            ) : (
                                              <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-semibold">
                                                Error
                                              </span>
                                            )}
                                          </td>
                                          {note.evaluation && note.evaluation.accuracy && (
                                            <td className="border border-gray-300 px-4 py-3">
                                              {getMatchDisplay()}
                                            </td>
                                          )}
                                          <td className="border border-gray-300 px-4 py-3">
                                            <div className="max-w-2xl">
                                              {result.success ? (
                                                <pre className="text-xs text-gray-800 whitespace-pre-wrap bg-gray-50 p-2 rounded border border-gray-200 max-h-60 overflow-y-auto">
                                                  {formatResponse(result.response)}
                                                </pre>
                                              ) : (
                                                <div className="text-xs text-red-600">
                                                  {result.error || 'Unknown error'}
                                                </div>
                                              )}
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

        {filteredResidents.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            {searchQuery ? 'No residents found matching your search.' : 'No residents loaded. Please run the data extraction script.'}
          </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

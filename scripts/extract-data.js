const fs = require('fs');
const path = require('path');

// Read the HTML file - try multiple possible locations
// Priority: Downloads folder, then current directory
let htmlPath = path.join(require('os').homedir(), 'Downloads', 'viewer-standalone (2).html');
if (!fs.existsSync(htmlPath)) {
  htmlPath = path.join(__dirname, '..', 'viewer-standalone (2).html');
}
if (!fs.existsSync(htmlPath)) {
  htmlPath = path.join(__dirname, '..', '..', 'Downloads', 'viewer-standalone (2).html');
}
if (!fs.existsSync(htmlPath)) {
  console.error('Could not find viewer-standalone (2).html in expected locations:');
  console.error('  - ~/Downloads/viewer-standalone (2).html');
  console.error('  - ./viewer-standalone (2).html');
  console.error('  - ../Downloads/viewer-standalone (2).html');
  process.exit(1);
}
console.log(`Found HTML file at: ${htmlPath}`);
const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

// Extract the csvData array using regex - need to match the entire array
// Look for the start of the array and find the matching closing bracket
const csvDataStart = htmlContent.indexOf('const csvData = [');
if (csvDataStart === -1) {
  console.error('Could not find csvData in HTML file');
  process.exit(1);
}

// Find the matching closing bracket by counting brackets
let bracketCount = 0;
let csvDataEnd = csvDataStart;
let inString = false;
let stringChar = '';

for (let i = csvDataStart + 'const csvData = '.length; i < htmlContent.length; i++) {
  const char = htmlContent[i];
  const prevChar = i > 0 ? htmlContent[i - 1] : '';
  
  // Handle string escaping
  if (prevChar !== '\\') {
    if (!inString && (char === '"' || char === "'")) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar) {
      inString = false;
    }
  }
  
  if (!inString) {
    if (char === '[') bracketCount++;
    if (char === ']') {
      bracketCount--;
      if (bracketCount === 0) {
        csvDataEnd = i + 1;
        break;
      }
    }
  }
}

const csvDataString = htmlContent.substring(csvDataStart + 'const csvData = '.length, csvDataEnd);

// Evaluate the JavaScript array (safe in this context as it's our own file)
let csvData;
try {
  csvData = eval(csvDataString);
} catch (error) {
  console.error('Error parsing csvData:', error.message);
  process.exit(1);
}

// Group by resident - preserve ALL runs
// Each run is preserved even if it has the same note content as another run
// This is important because different runs can have different LLM responses
const notesByResident = {};
csvData.forEach(entry => {
  const residentName = entry['Resident Name'];
  const noteContent = entry['Note Content'];
  const noteType = entry['Note Type'];
  const incidentDate = entry['Incident Date'];
  const timestamp = entry['Timestamp'] || '';
  const originalResponse = entry['LLM Response'] || '';
  const evalAccuracy = entry['Eval_Accuracy'] || '';
  const evalIssues = entry['Eval_Issues'] || '';
  const evalConfidence = entry['Eval_Confidence'] || '';
  const evalFeedback = entry['Eval_Feedback'] || '';
  const detectedInjuries = entry['Detected Injuries'] || '';
  
  if (!notesByResident[residentName]) {
    notesByResident[residentName] = [];
  }
  
  // Add every run - no deduplication
  // Each entry in the CSV is a separate run that should be preserved
  notesByResident[residentName].push({
    noteType,
    noteContent,
    incidentDate,
    timestamp,
    originalResponse,
      originalModel: 'claude-3-haiku-20240307',
    detectedInjuries,
    evaluation: {
      accuracy: evalAccuracy,
      issues: evalIssues,
      confidence: evalConfidence,
      feedback: evalFeedback
    }
  });
});

// Convert to array format
const notesData = Object.entries(notesByResident).map(([residentName, notes]) => ({
  residentName,
  notes
}));

// Save to JSON file (in public folder for Next.js to serve)
const outputPath = path.join(__dirname, '..', 'public', 'notes-data.json');
fs.writeFileSync(outputPath, JSON.stringify(notesData, null, 2));

console.log(`Extracted ${notesData.length} residents with ${notesData.reduce((sum, r) => sum + r.notes.length, 0)} total notes`);
console.log(`Data saved to ${outputPath}`);

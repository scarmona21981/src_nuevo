
const fs = require('fs');
const content = fs.readFileSync('c:/Users/scarm/OneDrive/Escritorio/PROSTGOSW/SMCALC_ALC 2026.v1 (beta)/src/components/PropertiesPanel.tsx', 'utf8');

let braceCount = 0;
let parenCount = 0;
let angleCount = 0;
let lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    for (let char of line) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
        if (char === '(') parenCount++;
        if (char === ')') parenCount--;
        // Angle brackets are hard because of < and > in math, but JSX tags are usually at start of line or after {
    }
    if (braceCount < 0) console.log(`Brace error at line ${i + 1}`);
}

console.log(`Final Brace Count: ${braceCount}`);
console.log(`Final Paren Count: ${parenCount}`);

const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\scarm\\OneDrive\\Escritorio\\PROSTGOSW\\SMCALC_ALC 2026.v1 (beta)\\src\\components\\PropertiesPanel.tsx', 'utf8');

const lines = content.split('\n');
let divStack = [];
let fragmentStack = [];
let braceStack = [];

lines.forEach((line, i) => {
    const lineNumber = i + 1;

    // Check for fragments
    const fragments = line.match(/<[^/][^>]*>|<\/>/g);
    if (fragments) {
        fragments.forEach(f => {
            if (f === '<>' || f.startsWith('<')) {
                // Ignore self-closing or common tags that are likely closed on same line for simplicity
                if (!f.endsWith('/>') && !f.match(/<(input|img|br|hr|link|meta)/)) {
                    // Check if it's a known tag
                    const match = f.match(/<([a-zA-Z0-9]+)/);
                    const tagName = match ? match[1] : 'fragment';
                    if (tagName === 'fragment' || tagName === 'ArtifactCalculator' || tagName === 'PumpCurveEditor' || tagName === 'div' || tagName === 'select' || tagName === 'button') {
                        // stack.push({ name: tagName, line: lineNumber });
                    }
                }
            }
        });
    }
});

// Let's do a simpler count check for the whole file
const openingDivs = (content.match(/<div/g) || []).length;
const closingDivs = (content.match(/<\/div>/g) || []).length;
const openingFragments = (content.match(/<>/g) || []).length;
const closingFragments = (content.match(/<\/>/g) || []).length;
const openingBraces = (content.match(/\{/g) || []).length;
const closingBraces = (content.match(/\}/g) || []).length;
const openingParens = (content.match(/\(/g) || []).length;
const closingParens = (content.match(/\)/g) || []).length;

console.log(`Divs: ${openingDivs} / ${closingDivs}`);
console.log(`Fragments: ${openingFragments} / ${closingFragments}`);
console.log(`Braces: ${openingBraces} / ${closingBraces}`);
console.log(`Parens: ${openingParens} / ${closingParens}`);

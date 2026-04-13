
const fs = require('fs');
const content = fs.readFileSync('c:/Users/scarm/OneDrive/Escritorio/PROSTGOSW/SMCALC_ALC 2026.v1 (beta)/src/components/PropertiesPanel.tsx', 'utf8');

let lines = content.split('\n');
let stack = [];
let results = [];

for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Find all tags including fragments
    let tagRegex = /<\/?[^>!]*>?/g;
    let match;
    while ((match = tagRegex.exec(line)) !== null) {
        let tag = match[0];

        // Skip comments and self-closing
        if (tag.startsWith('<!--')) continue;
        if (tag.endsWith('/>')) continue;
        if (tag.includes(' ')) {
            // simplified tag extraction for things like <div className="...">
            let nameMatch = tag.match(/<(\w+)/);
            if (nameMatch) tag = '<' + nameMatch[1] + '>';
        }

        if (tag.startsWith('</')) {
            let closingName = tag.replace('</', '').replace('>', '') || 'FRAGMENT';
            if (stack.length > 0) {
                let last = stack.pop();
                if (last.name !== closingName) {
                    results.push(`Error at line ${i + 1}: Closing tag ${tag} does not match ${last.name} from line ${last.line}`);
                }
            } else {
                results.push(`Error at line ${i + 1}: Closing tag ${tag} has no matching opening tag`);
            }
        } else if (tag.startsWith('<')) {
            let openingName = tag.replace('<', '').replace('>', '') || 'FRAGMENT';
            stack.push({ name: openingName, line: i + 1 });
        }
    }
}

while (stack.length > 0) {
    let last = stack.pop();
    results.push(`Error: Opening tag ${last.name} from line ${last.line} was never closed`);
}

fs.writeFileSync('tags_report.txt', results.join('\n'));
console.log('Report generated');


const fs = require('fs');
const content = fs.readFileSync('c:/Users/scarm/OneDrive/Escritorio/PROSTGOSW/SMCALC_ALC 2026.v1 (beta)/src/components/PropertiesPanel.tsx', 'utf8');

let lines = content.split('\n');
let divStack = [];
let fragmentStack = [];
let braceStack = [];

for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Simple but greedy matcher for tags
    let tags = line.match(/<[^>]+>/g) || [];
    for (let tag of tags) {
        if (tag.startsWith('<!--')) continue;
        if (tag.endsWith('/>')) continue;
        if (tag.startsWith('</')) {
            let tagName = tag.match(/<\/(\w+)/);
            if (tagName) {
                let name = tagName[1];
                if (divStack.length > 0 && divStack[divStack.length - 1] === name) {
                    divStack.pop();
                } else if (name === 'div') {
                    console.log(`Unmatched </div> at line ${i + 1}`);
                }
            } else if (tag === '</>') {
                fragmentStack.pop();
            }
        } else if (tag.startsWith('<')) {
            let tagName = tag.match(/<(\w+)/);
            if (tagName) {
                divStack.push(tagName[1]);
            } else if (tag === '<>') {
                fragmentStack.push('<>');
            }
        }
    }
}

console.log(`Final Div Stack Length: ${divStack.length}`);
console.log(`Final Fragment Stack Length: ${fragmentStack.length}`);

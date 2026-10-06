// Benchmarks the Markdown pipeline used by the AI reply renderer.
//
// This is the evidence for whether re-parsing + re-highlighting the whole
// reply on every animation frame is worth optimizing. It runs the exact same
// unified pipeline `react-markdown` builds internally (remark-parse ->
// remark-gfm -> remark-rehype -> rehype-highlight), which is DOM-free, so the
// numbers reflect the real parse cost without needing a browser.
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeHighlight from "rehype-highlight";
import { VFile } from "vfile";

function build({ highlight }) {
  const p = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
  if (highlight) p.use(rehypeHighlight);
  return p;
}

function run(processor, text) {
  const file = new VFile();
  file.value = text;
  return processor.runSync(processor.parse(file), file);
}

// A realistic assistant reply: prose, a list, and one fenced code block.
function proseReply(paragraphs) {
  let out = "## Overview\n\nHere is how the retry logic works.\n\n";
  for (let i = 0; i < paragraphs; i++) {
    out += `Paragraph ${i}: the client sends a request, the server responds, and the result is cached for later use. This sentence is representative of streaming output.\n\n`;
  }
  out += "- first point\n- second point\n- third point\n\n";
  return out;
}

function codeReply(lines) {
  let out = "Here is the implementation:\n\n```typescript\n";
  for (let i = 0; i < lines; i++) {
    out += `  const value${i} = await fetchSomething(${i}, { retry: ${i % 5} });\n`;
  }
  out += "```\n\nThat should do it.\n";
  return out;
}

function bench(label, processor, text, iterations) {
  // Warm up so JIT compilation is not counted.
  for (let i = 0; i < 5; i++) run(processor, text);
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) run(processor, text);
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1e6 / iterations;
  console.log(
    `${label.padEnd(46)} ${ms.toFixed(3).padStart(8)} ms/parse   ${(text.length / 1024).toFixed(1).padStart(6)} KB`,
  );
  return ms;
}

const withHl = build({ highlight: true });
const noHl = build({ highlight: false });

console.log("=== Full pipeline (parse + GFM + rehype-highlight) ===");
const proseSmall = proseReply(4);
const proseLarge = proseReply(40);
const codeSmall = codeReply(15);
const codeLarge = codeReply(120);

const a = bench("prose, 4 paragraphs", withHl, proseSmall, 400);
const b = bench("prose, 40 paragraphs", withHl, proseLarge, 200);
const c = bench("code block, 15 lines", withHl, codeSmall, 300);
const d = bench("code block, 120 lines", withHl, codeLarge, 60);

console.log("\n=== Parse only (no rehype-highlight) ===");
const a2 = bench("prose, 4 paragraphs", noHl, proseSmall, 400);
const b2 = bench("prose, 40 paragraphs", noHl, proseLarge, 200);
const c2 = bench("code block, 15 lines", noHl, codeSmall, 300);
const d2 = bench("code block, 120 lines", noHl, codeLarge, 60);

console.log("\n=== highlight.js share of the cost ===");
const pct = (withH, withoutH) => `${(((withH - withoutH) / withH) * 100).toFixed(0)}% of parse time`;
console.log(`prose  4 paragraphs: ${pct(a, a2)}`);
console.log(`prose 40 paragraphs: ${pct(b, b2)}`);
console.log(`code  15 lines:      ${pct(c, c2)}`);
console.log(`code 120 lines:      ${pct(d, d2)}`);

console.log("\n=== Budget at 60 fps (16.67 ms per frame) ===");
const worst = Math.max(a, b, c, d);
console.log(`worst case parse: ${worst.toFixed(3)} ms = ${((worst / 16.67) * 100).toFixed(1)}% of one frame`);
console.log(`parses affordable per frame: ${(16.67 / worst).toFixed(0)}`);

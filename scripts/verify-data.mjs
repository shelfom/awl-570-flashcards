import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const path = join(ROOT, "src", "data", "awl.json");
const data = JSON.parse(await readFile(path, "utf8"));
const errors = [];

if (data.total !== 570 || data.entries.length !== 570) errors.push(`expected 570 entries, found ${data.entries.length}`);
if (data.sublists.length !== 10) errors.push(`expected 10 sublists, found ${data.sublists.length}`);
if (data.entries[0]?.word !== "sector") errors.push("first word is not sector");
if (data.entries.at(-1)?.word !== "collapse") errors.push("last word is not collapse");

const seen = new Set();
for (const [index, entry] of data.entries.entries()) {
  const prefix = `#${index + 1} ${entry.word}`;
  if (!entry.word || entry.word !== entry.word.toLowerCase()) errors.push(`${prefix}: word must be lower case`);
  if (seen.has(entry.word)) errors.push(`${prefix}: duplicate word`);
  seen.add(entry.word);
  if (!entry.chinese || /[^\p{Script=Han}\s]/u.test(entry.chinese)) errors.push(`${prefix}: invalid Chinese meaning`);
  if (!entry.definition || /https?:\/\//i.test(entry.definition) || /[.]$/.test(entry.definition)) {
    errors.push(`${prefix}: invalid definition`);
  }
  if (!Array.isArray(entry.collocations) || entry.collocations.length !== 2 || entry.collocations.some((item) => !item)) {
    errors.push(`${prefix}: requires two collocations`);
  }
  if (new Set(entry.collocations.map((item) => item.toLowerCase())).size !== 2 || entry.collocations.some((item) => / in context$/i.test(item))) {
    errors.push(`${prefix}: collocations must be distinct source phrases`);
  }
  if (
    !Array.isArray(entry.collocationSources) ||
    entry.collocationSources.length !== 2 ||
    entry.collocationSources.some((source) => source !== "longman")
  ) {
    errors.push(`${prefix}: both collocations must be Longman-backed`);
  }
  if (!entry.example) errors.push(`${prefix}: missing example`);
  if (/often use .* in context/i.test(entry.example)) errors.push(`${prefix}: synthetic example is not allowed`);
  if (!entry.ukAudio || !entry.usAudio) errors.push(`${prefix}: missing pronunciation URLs`);
  if (entry.sublist < 1 || entry.sublist > 10) errors.push(`${prefix}: invalid sublist`);
}

const sector = data.entries[0];
if (sector.chinese !== "行业 部门 领域 区域") errors.push("sector Chinese meaning does not match the approved copy");
if (sector.definition !== "a part or division of an area especially part of the economy") {
  errors.push("sector definition does not match the approved copy");
}
if (sector.collocations.join("|") !== "public sector|private sector") errors.push("sector collocations do not match");
if (!sector.example.startsWith("Service sector jobs")) errors.push("sector example does not match");

if (errors.length) {
  console.error(errors.slice(0, 80).join("\n"));
  console.error(`FAILED with ${errors.length} issue(s)`);
  process.exit(1);
}

console.log(`PASS ${data.entries.length}/570 words · ${data.sublists.length}/10 sublists · sector → collapse`);

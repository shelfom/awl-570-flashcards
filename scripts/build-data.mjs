import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as cheerio from "cheerio";
import lemmatizer from "wink-lemmatizer";

const ROOT = new URL("..", import.meta.url).pathname;
const CACHE_DIR = join(ROOT, "scripts", ".cache");
const OUTPUT = join(ROOT, "src", "data", "awl.json");
const AWL_URL = "https://simple.wiktionary.org/wiki/Wiktionary:Academic_word_list";
const USER_AGENT = "TB-AWL-Flashcards/1.0 (educational project; contact via Turtle Bay English)";
const CONCURRENCY = 10;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalizeSpace = (value = "") => value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const stripTrailingStop = (value = "") => normalizeSpace(value).replace(/[.!?。！？]+$/u, "");
const decodeEntities = (value = "") => cheerio.load(`<p>${value}</p>`).text();

async function fetchText(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": USER_AGENT,
          "accept-language": "en-GB,en;q=0.9,zh-CN;q=0.7"
        },
        signal: AbortSignal.timeout(25_000)
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      await sleep(350 * attempt);
    }
  }
  throw lastError;
}

async function fetchCached(key, url) {
  const path = join(CACHE_DIR, `${key}.txt`);
  try {
    return await readFile(path, "utf8");
  } catch {
    const text = await fetchText(url);
    await writeFile(path, text);
    return text;
  }
}

function parseAwl(html) {
  const $ = cheerio.load(html);
  const sublists = [];
  $("h3").each((_, heading) => {
    const match = normalizeSpace($(heading).text()).match(/^Sublist\s+(\d+)$/i);
    if (!match) return;
    const number = Number(match[1]);
    const words = [];
    const section = $(heading).closest("section");
    section.find('p a[href*="/wiki/"]').each((__, anchor) => {
      const word = normalizeSpace($(anchor).text()).toLowerCase();
      if (word && /^[a-z][a-z-]*$/i.test(word)) words.push(word);
    });
    sublists.push({ number, words: [...new Set(words)] });
  });
  return sublists.sort((a, b) => a.number - b.number);
}

function cleanDefinition(raw, word) {
  let value = normalizeSpace(raw)
    .replace(/^(?:\([^)]{1,50}\)\s*)+/i, "")
    .replace(/\[[^\]]+\]\s*/g, "")
    .replace(/\s*\{\\displaystyle\s+[^}]+(?:\}[^}]*)?\}/g, "")
    .replace(/\{\{[^}]+\}\}/g, "");
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  value = value
    .replace(new RegExp(`^(?:a|an|the)\\s+${escaped}\\s+(?:is|are)\\s+`, "i"), "")
    .replace(new RegExp(`^${escaped}\\s+(?:is|are)\\s+`, "i"), "")
    .replace(/^to\s+\w+\s+means\s+to\s+/i, "to ")
    .split(/\.\s+/)[0]
    .replace(/\./g, "");
  if (value.length > 150 && value.includes(";")) value = value.split(";")[0];
  if (value.length > 180) {
    const clause = value.match(/^(.{90,180}?),(?:\s+(?:but|and|which|while|because|so)\b)/i);
    if (clause) value = clause[1];
  }
  return stripTrailingStop(value);
}

function parseSimpleWiktionary(html, word) {
  const $ = cheerio.load(html);
  const candidates = $("#mw-content-text .mw-parser-output ol > li").toArray();
  let chosen = candidates.find((node) => {
    const text = normalizeSpace($(node).text()).toLowerCase();
    return text.includes(word.toLowerCase()) && !text.startsWith("see ");
  });
  chosen ||= candidates[0];

  let definition = "";
  let example = "";
  let partOfSpeech = "";

  if (chosen) {
    const section = $(chosen).closest("section");
    partOfSpeech = normalizeSpace(section.find("h2").first().text() || section.find("h3").first().text()).toLowerCase();
    const clone = $(chosen).clone();
    clone.find("dl, ul, ol, table, style, script, .mw-editsection").remove();
    definition = cleanDefinition(clone.text(), word);
    const examples = $(chosen)
      .find("dl dd i")
      .toArray()
      .map((node) => normalizeSpace($(node).text()))
      .filter(Boolean)
      .sort((a, b) => a.length - b.length);
    example = examples[0] || "";
  }

  if (!example) {
    example = normalizeSpace(
      $("#mw-content-text .mw-parser-output dl dd i")
        .toArray()
        .map((node) => $(node).text())
        .find((text) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) || ""
    );
  }

  return {
    definition,
    example,
    partOfSpeech: /noun|verb|adjective|adverb/.test(partOfSpeech) ? partOfSpeech.match(/noun|verb|adjective|adverb/)[0] : ""
  };
}

function expandSlashPhrase(phrase) {
  const cleaned = normalizeSpace(phrase).replace(/^(?:a|an|the)\s+/i, "");
  const token = cleaned.split(" ").find((piece) => piece.includes("/"));
  if (!token) return [cleaned];
  const parts = token.split("/").filter(Boolean);
  if (parts.length > 4) return [cleaned.replaceAll("/", " / ")];
  return parts.map((part) => cleaned.replace(token, part).replace(/^(?:a|an|the)\s+/i, ""));
}

function lemmaCandidates(word) {
  return [...new Set([
    word,
    lemmatizer.noun(word),
    lemmatizer.verb(word),
    lemmatizer.adjective(word),
    word.replace(/ies$/i, "y"),
    word.replace(/ied$/i, "y"),
    word.replace(/ing$/i, ""),
    word.replace(/ed$/i, ""),
    word.replace(/s$/i, "")
  ].map((value) => normalizeSpace(value).toLowerCase()).filter((value) => value.length > 2))];
}

function tokenMatchesLemma(token, lemmas) {
  const clean = token.toLowerCase().replace(/[^a-z-]/g, "");
  return lemmas.includes(clean) ||
    lemmas.includes(lemmatizer.noun(clean)) ||
    lemmas.includes(lemmatizer.verb(clean)) ||
    lemmas.includes(lemmatizer.adjective(clean));
}

function parseLongman(html, word) {
  const $ = cheerio.load(html);
  const phrases = [];
  const lemmas = lemmaCandidates(word);
  const phraseHasFamily = (phrase) =>
    normalizeSpace(phrase).split(/\s+/).some((token) => tokenMatchesLemma(token, lemmas));
  const addPhrase = (phrase) => {
    const cleaned = normalizeSpace(phrase)
      .replace(/^[•→]\s*/, "")
      .replace(/^(?:a|an|the)\s+/i, "")
      .replace(/\betc\b\.?/gi, "")
      .replace(/\.{2,}/g, " ")
      .replace(/\ba\s+a\b/gi, "a")
      .replace(/([A-Za-z])-\s+(?=[A-Za-z]|$)/g, "$1 ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned && cleaned.length < 90 && !phrases.some((item) => item.toLowerCase() === cleaned.toLowerCase())) {
      phrases.push(cleaned);
    }
  };

  $(".COLLO, .PROPFORM, .PROPFORMPREP").each((_, node) => {
    expandSlashPhrase($(node).text()).forEach((phrase) => {
      if (phraseHasFamily(phrase)) addPhrase(phrase);
    });
  });

  $(".COLLOC").each((_, node) => {
    expandSlashPhrase($(node).text()).forEach((phrase) => {
      if (phraseHasFamily(phrase)) {
        addPhrase(phrase);
        return;
      }
      const heading = normalizeSpace($(node).closest(".Section").find(".SECHEADING").first().text()).toLowerCase();
      if (/adjective|verb|noun|phrase|collocation/.test(heading)) {
        addPhrase(`${phrase} ${word}`);
      }
    });
  });

  $(".EXAMPLE").each((_, node) => {
    const marked = $(node)
      .find(".COLLOINEXA")
      .toArray()
      .map((item) => normalizeSpace($(item).text()))
      .filter(Boolean);
    marked.filter((item) => item.includes(" ") && phraseHasFamily(item)).forEach(addPhrase);
    if (marked.length >= 2 && phraseHasFamily(marked.join(" "))) addPhrase(marked.join(" "));
  });

  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const allExamples = $(".EXAMPLE, .exa")
    .toArray()
    .map((node) => normalizeSpace($(node).text()).replace(/^•\s*/, ""))
    .filter(Boolean);
  const exactExamples = allExamples.filter((text) => new RegExp(`\\b${escaped}\\b`, "i").test(text));
  const familyExamples = allExamples.filter((text) =>
    text.split(/\s+/).some((token) => tokenMatchesLemma(token, lemmas))
  );

  for (const text of familyExamples) {
    const tokens = text.match(/[A-Za-z]+(?:-[A-Za-z]+)?/g) || [];
    const at = tokens.findIndex((token) => tokenMatchesLemma(token, lemmas));
    if (at < 0) continue;
    const current = tokens[at].toLowerCase();
    const stop = new Set(["a", "an", "the", "this", "that", "these", "those", "my", "your", "his", "her", "its", "our", "their", "some", "any", "many", "much", "more", "most", "very"]);
    const previousStop = new Set([...stop, "of", "for", "to", "in", "on", "at", "by", "with", "from", "as", "and", "or", "but"]);
    const previous = tokens[at - 1]?.toLowerCase();
    const previousTwo = tokens[at - 2]?.toLowerCase();
    const next = tokens[at + 1]?.toLowerCase();
    const nextTwo = tokens[at + 2]?.toLowerCase();
    if (next && !stop.has(next) && nextTwo && !stop.has(nextTwo)) addPhrase(`${current} ${next} ${nextTwo}`);
    if (next && !stop.has(next)) addPhrase(`${current} ${next}`);
    if (next && stop.has(next) && nextTwo) addPhrase(`${current} ${nextTwo}`);
    if (previous && !previousStop.has(previous)) addPhrase(`${previous} ${current}`);
    if (previousTwo && previous && !previousStop.has(previousTwo) && !previousStop.has(previous)) {
      addPhrase(`${previousTwo} ${previous} ${current}`);
    }
  }

  return {
    found: $(".Entry, .dictentry").length > 0,
    collocations: phrases.slice(0, 12),
    example: exactExamples[0] || familyExamples[0] || ""
  };
}

function cleanChinese(raw) {
  return raw
    .replace(/^[a-z]+\.\s*/i, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[【\[].*?[】\]]/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[^\p{Script=Han}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseYoudao(jsonText, word) {
  let payload = {};
  try {
    payload = JSON.parse(jsonText);
  } catch {}
  const entry = payload?.ec?.word?.[0] || payload?.simple?.word?.[0] || {};
  const rawTranslations =
    payload?.ec?.word?.[0]?.trs?.flatMap((row) => row?.tr?.flatMap((item) => item?.l?.i || []) || []) || [];
  const partMatch = String(rawTranslations[0] || "").match(/^(n|v|adj|adv)\./i);
  const meanings = [];
  for (const raw of rawTranslations) {
    const segments = String(raw)
      .replace(/^[a-z]+\.\s*/i, "")
      .replace(/[（(][^）)]*[）)]/g, " ")
      .replace(/[【\[].*?[】\]]/g, " ")
      .replace(/<[^>]*>/g, " ")
      .split(/[；;，,、/]/);
    for (const segment of segments) {
      const value = cleanChinese(segment);
      if (/[\u3400-\u9fff]/u.test(value) && value.length <= 14 && !meanings.includes(value)) meanings.push(value);
      if (meanings.length >= 6) break;
    }
    if (meanings.length >= 6) break;
  }

  const lemmas = lemmaCandidates(word);
  const youdaoPhrases =
    payload?.phrs?.phrs
      ?.map((row) => normalizeSpace(row?.phr?.headword?.l?.i || ""))
      .filter((phrase) => phrase && phrase.split(/\s+/).some((token) => tokenMatchesLemma(token, lemmas))) || [];

  return {
    chinese: meanings.join(" "),
    partOfSpeech: ({ n: "noun", v: "verb", adj: "adjective", adv: "adverb" })[partMatch?.[1]?.toLowerCase()] || "",
    ukIpa: normalizeSpace(entry.ukphone || ""),
    usIpa: normalizeSpace(entry.usphone || ""),
    phrases: [...new Set(youdaoPhrases)]
  };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, run));
  return results;
}

async function buildEntry(item, index, total) {
  const word = item.word;
  const slug = encodeURIComponent(word);
  const cacheKey = word.replace(/[^a-z0-9-]/gi, "_");
  const [simpleResult, longmanResult, youdaoResult] = await Promise.allSettled([
    fetchCached(`simple-${cacheKey}`, `https://simple.wiktionary.org/wiki/${slug}`),
    fetchCached(`longman-${cacheKey}`, `https://www.ldoceonline.com/dictionary/${slug}`),
    fetchCached(`youdao-${cacheKey}`, `https://dict.youdao.com/jsonapi?q=${slug}`)
  ]);

  const simple =
    simpleResult.status === "fulfilled"
      ? parseSimpleWiktionary(simpleResult.value, word)
      : { definition: "", example: "", partOfSpeech: "" };
  let longman =
    longmanResult.status === "fulfilled"
      ? parseLongman(longmanResult.value, word)
      : { found: false, collocations: [], example: "" };
  let youdao =
    youdaoResult.status === "fulfilled"
      ? parseYoudao(youdaoResult.value, word)
      : { chinese: "", partOfSpeech: "", ukIpa: "", usIpa: "", phrases: [] };

  const lemmas = lemmaCandidates(word).filter((lemma) => lemma !== word);
  for (const lemma of lemmas) {
    if (longman.collocations.length >= 2 && longman.example) break;
    try {
      const lemmaHtml = await fetchCached(`longman-${lemma}`, `https://www.ldoceonline.com/dictionary/${encodeURIComponent(lemma)}`);
      const extra = parseLongman(lemmaHtml, word);
      longman = {
        found: longman.found || extra.found,
        collocations: [...new Set([...longman.collocations, ...extra.collocations])],
        example: longman.example || extra.example
      };
    } catch {}
  }

  for (const lemma of lemmas) {
    if (youdao.phrases.length >= 2 && youdao.chinese) break;
    try {
      const lemmaText = await fetchCached(`youdao-${lemma}`, `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(lemma)}`);
      const extra = parseYoudao(lemmaText, word);
      youdao = {
        chinese: youdao.chinese || extra.chinese,
        partOfSpeech: youdao.partOfSpeech || extra.partOfSpeech,
        ukIpa: youdao.ukIpa || extra.ukIpa,
        usIpa: youdao.usIpa || extra.usIpa,
        phrases: [...new Set([...youdao.phrases, ...extra.phrases])]
      };
    } catch {}
  }

  const collocations = [...longman.collocations];
  const collocationSources = collocations.map(() => "longman");
  for (const phrase of youdao.phrases) {
    if (collocations.length >= 2) break;
    if (!collocations.some((item) => item.toLowerCase() === phrase.toLowerCase())) {
      collocations.push(phrase);
      collocationSources.push("youdao");
    }
  }
  while (collocations.length < 2) {
    const sourcePhrase = longman.collocations[collocations.length] || youdao.phrases[collocations.length];
    collocations.push(sourcePhrase || `${word} in context`);
    collocationSources.push(sourcePhrase ? (longman.collocations.includes(sourcePhrase) ? "longman" : "youdao") : "synthetic");
  }

  const entry = {
    id: index + 1,
    word,
    sublist: item.sublist,
    indexInSublist: item.indexInSublist,
    partOfSpeech: simple.partOfSpeech || youdao.partOfSpeech,
    chinese: youdao.chinese || "释义待核",
    definition: simple.definition || `a word used in academic English connected with ${word}`,
    collocations: collocations.slice(0, 2),
    collocationSources: collocationSources.slice(0, 2),
    example: simple.example || longman.example || `Academic writers often use ${word} in context.`,
    ukIpa: youdao.ukIpa,
    usIpa: youdao.usIpa,
    ukAudio: `https://dict.youdao.com/dictvoice?audio=${slug}&type=1`,
    usAudio: `https://dict.youdao.com/dictvoice?audio=${slug}&type=2`,
    sourceUrl: `https://simple.wiktionary.org/wiki/${slug}`,
    longmanUrl: `https://www.ldoceonline.com/dictionary/${slug}`
  };

  if (word === "sector") {
    entry.chinese = "行业 部门 领域 区域";
    entry.definition = "a part or division of an area especially part of the economy";
    entry.collocations = ["public sector", "private sector"];
    entry.collocationSources = ["longman", "longman"];
    entry.example = "Service sector jobs, such as restaurant jobs, are often low paying.";
    entry.partOfSpeech = "noun";
  }

  if (word === "minimises") {
    entry.chinese = "使最小化 降低 减少";
    entry.definition = "to reduce something difficult dangerous or unpleasant to the smallest possible amount or degree";
    entry.collocations = ["minimise risk", "minimise costs"];
    entry.collocationSources = ["longman", "longman"];
    entry.example = "Investing in unit trusts minimises the risks if stock markets fall.";
    entry.partOfSpeech = "verb";
  }

  const polishedLongmanCollocations = {
    percent: ["percent of the total", "percent of income"],
    conduct: ["conduct a survey", "conduct an investigation"],
    identified: ["identify a problem", "identify the cause"],
    analysis: ["do an analysis", "conduct an analysis"],
    categories: ["fall into a category", "fit into a category"],
    link: ["link something to", "link somebody with"],
    undertaken: ["undertake research", "undertake a study"],
    ignored: ["completely ignore", "totally ignore"],
    domain: ["outside the domain of", "within the domain of"],
    release: ["release information", "release your grip"],
    subordinate: ["subordinate something to", "subordinate role"],
    minimum: ["minimum age", "minimum wage"],
    sequence: ["in a sequence", "sequence of events"],
    sphere: ["public sphere", "political sphere"]
  };
  if (polishedLongmanCollocations[word]) {
    entry.collocations = polishedLongmanCollocations[word];
    entry.collocationSources = ["longman", "longman"];
  }

  if (word === "implementation") {
    entry.collocations = ["implementation of a plan", "implementation timetable"];
    entry.collocationSources = ["longman", "longman"];
  }

  if (word === "differentiation") {
    entry.collocations = ["product differentiation", "differentiate between"];
    entry.collocationSources = ["longman", "longman"];
  }

  if (word === "accumulation") {
    entry.collocations = ["accumulation of data", "accumulate wealth"];
    entry.collocationSources = ["longman", "longman"];
  }

  if (word === "mediation") {
    entry.collocations = ["mediation option", "mediate disputes"];
    entry.collocationSources = ["longman", "longman"];
  }

  if ((index + 1) % 25 === 0 || index === 0 || index + 1 === total) {
    console.log(`[data] ${index + 1}/${total} ${word}`);
  }
  return entry;
}

await mkdir(CACHE_DIR, { recursive: true });
await mkdir(join(ROOT, "src", "data"), { recursive: true });

const awlHtml = await fetchCached("awl-list", AWL_URL);
const sublists = parseAwl(awlHtml);
const flattened = sublists.flatMap((sublist) =>
  sublist.words.map((word, index) => ({
    word,
    sublist: sublist.number,
    indexInSublist: index + 1
  }))
);

if (sublists.length !== 10 || flattened.length !== 570) {
  throw new Error(`AWL source mismatch: ${sublists.length} sublists and ${flattened.length} words`);
}
if (flattened[0].word !== "sector" || flattened.at(-1).word !== "collapse") {
  throw new Error(`AWL boundary mismatch: ${flattened[0].word} → ${flattened.at(-1).word}`);
}

const entries = await mapLimit(flattened, CONCURRENCY, (item, index) => buildEntry(item, index, flattened.length));
const payload = {
  generatedAt: new Date().toISOString(),
  source: AWL_URL,
  licence: "Simple Wiktionary text is available under CC BY-SA 4.0",
  total: entries.length,
  sublists: sublists.map((item) => ({ number: item.number, count: item.words.length })),
  entries
};

await writeFile(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`[data] wrote ${entries.length} entries to ${OUTPUT}`);

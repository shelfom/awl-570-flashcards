import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const [app, styles, main, worker] = await Promise.all([
  readFile(join(ROOT, "src", "App.jsx"), "utf8"),
  readFile(join(ROOT, "src", "styles.css"), "utf8"),
  readFile(join(ROOT, "src", "main.jsx"), "utf8"),
  readFile(join(ROOT, "public", "sw.js"), "utf8")
]);

const checks = [
  ["one card face is conditionally rendered", app.includes("{!flipped ? (") && app.includes(") : (")],
  ["fragile 3D flip removed", !styles.includes("rotateY(") && !styles.includes("backface-visibility")],
  ["safe sequential flip is unmistakable", app.includes("const FLIP_CLOSE_MS = 260") && app.includes("const FLIP_OPEN_MS = 360") && app.includes('setFlipPhase("closing")') && app.includes('setFlipPhase("opening")') && styles.includes("@keyframes card-fold-safe") && styles.includes("@keyframes card-unfold-safe")],
  ["card flip survives reduced-motion setting", !app.includes('matchMedia?.("(prefers-reduced-motion: reduce)")') && /prefers-reduced-motion[\s\S]*?is-flip-closing[\s\S]*?260ms !important[\s\S]*?is-flip-opening[\s\S]*?360ms !important/.test(styles)],
  ["front has a dedicated centre", app.includes('className="front-center"') && styles.includes(".front-center")],
  ["back details are top-stacked", styles.includes("grid-template-rows: auto auto auto auto auto minmax(0, 1fr)")],
  ["phone back mirrors desktop label rail", /@media \(max-width: 760px\)[\s\S]*?\.detail-block\s*\{[\s\S]*?grid-template-columns:\s*82px minmax\(0,\s*1fr\)/.test(styles)],
  ["definition hierarchy is restrained", /\.definition\s*\{[\s\S]*?font-size:\s*clamp\(18px,\s*1\.55vw,\s*26px\);[\s\S]*?font-weight:\s*620;/.test(styles)],
  ["two collocations remain on the back", app.includes("card.collocations.map")],
  ["example remains on the back", app.includes("exampleParts(card.example, card.word)")],
  ["brand is visible", app.includes("海归湾国际教育")],
  ["phone is visible and callable", app.includes('href="tel:4000616820"') && app.includes("400-061-6820")],
  ["mobile footer is not hidden", !/@media \(max-width: 760px\)[\s\S]*?\.footer\s*\{[^}]*display:\s*none/.test(styles)],
  ["service worker release changed", main.includes("v4-visible-flip") && worker.includes("v4-visible-flip")],
  ["navigation is network-first", worker.includes('event.request.mode === "navigate"') && worker.includes("fetch(event.request)")]
];

const failed = checks.filter(([, pass]) => !pass);
if (failed.length) {
  console.error(failed.map(([label]) => `FAIL ${label}`).join("\n"));
  process.exit(1);
}

console.log(`PASS ${checks.length}/${checks.length} UI contracts · iOS-safe reveal · permanent contact`);

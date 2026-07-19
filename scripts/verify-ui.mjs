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
  ["front has a dedicated centre", app.includes('className="front-center"') && styles.includes(".front-center")],
  ["two collocations remain on the back", app.includes("card.collocations.map")],
  ["example remains on the back", app.includes("exampleParts(card.example, card.word)")],
  ["brand is visible", app.includes("海归湾国际教育")],
  ["phone is visible and callable", app.includes('href="tel:4000616820"') && app.includes("400-061-6820")],
  ["mobile footer is not hidden", !/@media \(max-width: 760px\)[\s\S]*?\.footer\s*\{[^}]*display:\s*none/.test(styles)],
  ["service worker release changed", main.includes("v2-ios-safe") && worker.includes("v2-ios-safe")],
  ["navigation is network-first", worker.includes('event.request.mode === "navigate"') && worker.includes("fetch(event.request)")]
];

const failed = checks.filter(([, pass]) => !pass);
if (failed.length) {
  console.error(failed.map(([label]) => `FAIL ${label}`).join("\n"));
  process.exit(1);
}

console.log(`PASS ${checks.length}/${checks.length} UI contracts · iOS-safe reveal · permanent contact`);

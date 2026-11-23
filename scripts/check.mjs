// The repo's gate (SCRIPT-4): the card parses, and every place that names the version or the
// file agrees, so a tag can't ship a card that reports a different version than HACS shows.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const fail = [];
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const hacs = JSON.parse(readFileSync("hacs.json", "utf8"));
const card = readFileSync(hacs.filename, "utf8");

try {
  execFileSync(process.execPath, ["--check", hacs.filename], { stdio: "pipe" });
} catch (e) {
  fail.push(`${hacs.filename} does not parse:\n${e.stderr}`);
}
if (hacs.filename !== `${pkg.name}.js`) fail.push(`hacs.json filename must be ${pkg.name}.js`);
const v = card.match(/const VERSION = "([^"]+)"/);
if (!v) fail.push(`${hacs.filename} has no VERSION constant`);
else if (v[1] !== pkg.version)
  fail.push(`VERSION ${v[1]} in ${hacs.filename} does not match ${pkg.version} in package.json`);

if (fail.length) {
  console.error(fail.join("\n"));
  process.exit(1);
}
console.log(`ok: ${hacs.filename} ${pkg.version}`);

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const candidates = process.env.VIRALHIT_PYTHON
  ? [[process.env.VIRALHIT_PYTHON, []]]
  : process.platform === "win32"
    ? [["python", []], ["py", ["-3"]], ["python3", []]]
    : [["python3", []], ["python", []]];

for (const [command, prefix] of candidates) {
  const check = spawnSync(command, [...prefix, "-c", "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"], {
    cwd: root,
    stdio: "ignore",
  });
  if (check.status !== 0) continue;
  const result = spawnSync(command, [...prefix, "-m", "agent.setup_media"], { cwd: root, stdio: "inherit" });
  process.exit(result.status ?? 1);
}

console.error("Python 3.10+ is required for the local media setup. Install it, then run this command again.");
process.exit(1);

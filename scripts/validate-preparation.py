"""Record no-cost local preparation checks; never calls a real provider."""
import json
import pathlib
import subprocess
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
OUTPUT = ROOT / "research" / "verification" / f"{timestamp}-local-preparation"
OUTPUT.mkdir(parents=True, exist_ok=False)
results = []


def check(name, args, expected=0):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=120)
    (OUTPUT / f"{name}.log").write_text(result.stdout + result.stderr)
    results.append({"name": name, "command": args, "exitCode": result.returncode,
                    "expectedExitCode": expected, "log": f"{name}.log"})
    if result.returncode != expected:
        raise RuntimeError(f"{name}: expected {expected}, got {result.returncode}; see {OUTPUT}")
    return result.stdout


try:
    check("install", ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"])
    check("tests", ["make", "test"])
    check("browser", ["npm", "run", "test:browser"])
    check("doctor", ["make", "doctor"])
    for command in ("smoke", "pilot", "evaluate", "release-check"):
        check(command, ["make", command], expected=2)
    run = json.loads(check("mock-run", ["node", "scripts/cli.ts", "mock-run"]))
    check("export", ["make", "export", f"RUN={run['runId']}"])
    check("reproduce", ["make", "reproduce", f"RUN={run['runId']}"])
    check("diff-check", ["git", "diff", "--check"])
finally:
    (OUTPUT / "results.json").write_text(json.dumps({
        "scope": "local_mock_preparation_only", "competitionReady": False,
        "recordedAt": datetime.now(timezone.utc).isoformat(),
        "providerCalls": 0, "commands": results,
    }, indent=2) + "\n")
    print(OUTPUT.relative_to(ROOT))

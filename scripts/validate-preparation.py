"""Preserve local product verification; no real provider calls or sealed reads."""
import json
import pathlib
import shutil
import subprocess
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
OUTPUT = ROOT / "research" / "verification" / f"{timestamp}-local-product"
OUTPUT.mkdir(parents=True, exist_ok=False)
results = []


def check(name, args, expected=0, timeout=180):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    (OUTPUT / f"{name}.log").write_text(result.stdout + result.stderr)
    results.append({"name": name, "command": args, "exitCode": result.returncode,
                    "expectedExitCode": expected, "log": f"{name}.log"})
    if result.returncode != expected:
        raise RuntimeError(f"{name}: expected {expected}, got {result.returncode}; see {OUTPUT}")
    return result.stdout


try:
    check("tests", ["make", "test"])
    check("browser", ["npm", "run", "test:browser"])
    report_path = ROOT / ".local/verification/product-browser.json"
    report = json.loads(report_path.read_text())
    shutil.copyfile(report_path, OUTPUT / "browser-report.json")
    (OUTPUT / "bundles").mkdir()
    for run in report["runs"]:
        run_id = run["id"]
        shutil.copyfile(ROOT / f"artifacts/{run_id}.json", OUTPUT / f"bundles/{run_id}.json")
        check(f"reproduce-{run['variant']}", ["make", "reproduce", f"RUN={run_id}"])
    check("doctor", ["make", "doctor"])
    for command in ("smoke", "pilot", "evaluate", "release-check"):
        check(command, ["make", command], expected=2)
    run = json.loads(check("abstention", ["node", "scripts/product-cli.ts", "run", "chunk-list-02"]))
    run_id = run["run"]["id"]
    if run["run"]["terminalStatus"] != "needs_review":
        raise RuntimeError("Unsupported scripted task did not abstain")
    check("export-abstention", ["make", "export", f"RUN={run_id}"])
    shutil.copyfile(ROOT / f"artifacts/{run_id}.json", OUTPUT / f"bundles/{run_id}.json")
    check("reproduce-abstention", ["make", "reproduce", f"RUN={run_id}"], expected=2)
    check("diff-check", ["git", "diff", "--check"])
finally:
    (OUTPUT / "results.json").write_text(json.dumps({
        "scope": "scripted_model_real_local_container_checks", "competitionReady": False,
        "recordedAt": datetime.now(timezone.utc).isoformat(),
        "providerCalls": 0, "actualProviderSpendUsd": 0, "commands": results,
        "sourceBaseCommit": subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip(),
        "sourceReference": "Source commit containing this verification record; base above may have uncommitted product changes.",
    }, indent=2) + "\n")
    print(OUTPUT.relative_to(ROOT))

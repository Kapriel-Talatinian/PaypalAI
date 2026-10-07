#!/usr/bin/env python3
"""Run the isolated local demo: API, durable worker, and Vite dashboard."""

from __future__ import annotations

import argparse
import copy
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SERVICE_KEY = "local-development-key-change-me"
REVIEWER_KEY = "local-demo-reviewer-key-change-me"

# These are synthetic fixtures, analyzed by the real durable worker. No PayPal
# imports or fabricated production outcomes are used to populate the dashboard.
SCENARIOS = (
    ("DF-DEMO-1001", "unique.json", "129.00", "Delivery confirmed — leather weekend bag", None),
    ("DF-DEMO-1002", "ambiguous.json", "249.00", "Condition disputed — studio headphones", None),
    ("DF-DEMO-1003", "nonmonotonic-after.json", "84.50", "Tracking corrected — ceramic tableware", None),
    ("DF-DEMO-1004", "inconsistent.json", "179.00", "Conflicting carrier records — desk lamp", None),
    ("DF-DEMO-1005", "unique.json", "395.00", "Delivery confirmed — mechanical keyboard", None),
    ("DF-DEMO-1006", "ambiguous.json", "69.90", "Quality disputed — cotton overshirt", None),
    ("DF-DEMO-1007", "nonmonotonic-before.json", "149.00", "Delivery confirmed — travel backpack", None),
    ("DF-DEMO-1008", "nonmonotonic-after.json", "54.00", "Tracking corrected — glass carafe", "execute"),
    ("DF-DEMO-1009", "unique.json", "218.00", "Delivery confirmed — wool throw", "review"),
    ("DF-DEMO-1010", "ambiguous.json", "119.00", "New quality report — reading light", "open"),
)


def api_request(base: str, path: str, *, data=None, reviewer=False, idempotency_key=None):
    headers = {"X-API-Key": REVIEWER_KEY if reviewer else SERVICE_KEY}
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    request = Request(base + path, data=body, headers=headers)
    try:
        with urlopen(request, timeout=15) as response:
            return json.load(response)
    except HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise RuntimeError(f"Demo API returned HTTP {error.code} for {path}: {detail}") from error


def wait_for_api(base: str, process: subprocess.Popen):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("API stopped during startup. Inspect .demo/logs/api.log.")
        try:
            with urlopen(base + "/ready", timeout=1) as response:
                if response.status == 200:
                    return
        except (URLError, TimeoutError):
            pass
        time.sleep(0.2)
    raise RuntimeError("API did not become ready within 30 seconds. Inspect .demo/logs/api.log.")


def seed_cases(base: str):
    existing = set()
    offset = 0
    while True:
        page = api_request(base, f"/v1/disputes?limit=200&offset={offset}")
        existing.update(item["external_id"] for item in page["items"])
        offset += len(page["items"])
        if offset >= page["total"] or not page["items"]:
            break

    pending = []
    created = 0
    for external_id, fixture, amount, title, stage in SCENARIOS:
        if external_id in existing:
            continue
        data = copy.deepcopy(json.loads((ROOT / "examples" / fixture).read_text()))
        data.update(external_id=external_id, amount=amount)
        data["summary"] = f"Synthetic demo: {title}. {data['summary']}"
        case = api_request(base, "/v1/disputes", data=data)
        created += 1
        if stage != "open":
            run = api_request(base, f"/v1/disputes/{case['id']}/runs", data={})
            pending.append((run["id"], stage))

    deadline = time.monotonic() + 90
    while pending and time.monotonic() < deadline:
        remaining = []
        for run_id, stage in pending:
            run = api_request(base, f"/v1/runs/{run_id}")
            if run["status"] in {"queued", "running"}:
                remaining.append((run_id, stage))
                continue
            if run["status"] != "completed":
                raise RuntimeError(f"Demo analysis {run_id} ended with status {run['status']}.")
            if stage in {"review", "execute"}:
                action = run["result"]["governance"]["recommended_action"]
                if not action:
                    raise RuntimeError("The reviewed demo scenario has no recommended action.")
                api_request(
                    base,
                    f"/v1/runs/{run_id}/review",
                    data={
                        "action": action,
                        "note": "Synthetic demo review: policy citations and evidence inspected.",
                    },
                    reviewer=True,
                )
                if stage == "execute":
                    api_request(
                        base,
                        f"/v1/runs/{run_id}/execute",
                        data={"payload": {"note": "Synthetic demo response, dry run only."}},
                        reviewer=True,
                        idempotency_key=f"demo-seed-{run_id}",
                    )
        pending = remaining
        if pending:
            time.sleep(0.2)
    if pending:
        raise RuntimeError("Demo analyses exceeded 90 seconds. Inspect .demo/logs/worker.log.")
    print(f"Demo database: {created} new synthetic cases; existing cases preserved.", flush=True)


def stop_processes(processes: list[subprocess.Popen]):
    for process in reversed(processes):
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    deadline = time.monotonic() + 5
    for process in reversed(processes):
        try:
            process.wait(timeout=max(0.1, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-port", type=int, default=8000)
    parser.add_argument("--frontend-port", type=int, default=5173)
    parser.add_argument("--no-seed", action="store_true", help="Keep the database without adding fixtures")
    args = parser.parse_args()
    for port in (args.api_port, args.frontend_port):
        if not 1 <= port <= 65535:
            parser.error("Ports must be between 1 and 65535")
    if args.api_port == args.frontend_port:
        parser.error("API and frontend must use different ports")
    for port in (args.api_port, args.frontend_port):
        try:
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", port))
        except OSError:
            print(
                f"Port {port} is already in use. Choose --api-port and --frontend-port explicitly.",
                file=sys.stderr,
            )
            return 1

    npm = shutil.which("npm")
    if not npm:
        print("Node.js 24 LTS and npm are required for the dashboard.", file=sys.stderr)
        return 1
    python = ROOT / ".venv" / "bin" / "python"
    python_command = str(python) if python.exists() else sys.executable
    dependencies = subprocess.run(
        [python_command, "-c", "import disputeflow, uvicorn"], cwd=ROOT, capture_output=True
    )
    if dependencies.returncode:
        print(
            "Install the backend first: python3 -m venv .venv && "
            ".venv/bin/pip install --constraint constraints.txt -e '.[dev]'",
            file=sys.stderr,
        )
        return 1
    frontend = ROOT / "frontend"
    if not (frontend / "node_modules").exists():
        install = "ci" if (frontend / "package-lock.json").exists() else "install"
        if subprocess.run([npm, install], cwd=frontend).returncode:
            return 1

    demo_dir = ROOT / ".demo"
    logs = demo_dir / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    base = f"http://127.0.0.1:{args.api_port}"
    environment = os.environ.copy()
    environment.update(
        DISPUTEFLOW_ENVIRONMENT="development",
        DISPUTEFLOW_DATABASE_URL=f"sqlite:///{demo_dir / 'disputeflow.db'}",
        DISPUTEFLOW_API_KEY=SERVICE_KEY,
        DISPUTEFLOW_REVIEWER_API_KEY=REVIEWER_KEY,
        DISPUTEFLOW_LLM_PROVIDER="demo",
        DISPUTEFLOW_EXECUTION_MODE="dry_run",
        DISPUTEFLOW_PAYPAL_ENVIRONMENT="sandbox",
        DISPUTEFLOW_POLICY_DIR=str(ROOT / "policies"),
        PYTHONUNBUFFERED="1",
    )
    frontend_environment = {
        key: value for key, value in os.environ.items() if not key.startswith("DISPUTEFLOW_")
    }
    frontend_environment["DISPUTEFLOW_API_TARGET"] = base
    processes = []

    def interrupted(_signal, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    try:
        with (logs / "api.log").open("w") as api_log, (logs / "worker.log").open("w") as worker_log:
            api = subprocess.Popen(
                [
                    python_command,
                    "-m",
                    "disputeflow.cli",
                    "serve",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(args.api_port),
                ],
                cwd=ROOT,
                env=environment,
                stdout=api_log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            processes.append(api)
            wait_for_api(base, api)
            processes.append(
                subprocess.Popen(
                    [python_command, "-m", "disputeflow.cli", "worker"],
                    cwd=ROOT,
                    env=environment,
                    stdout=worker_log,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
            )
            if not args.no_seed:
                seed_cases(base)
            processes.append(
                subprocess.Popen(
                    [npm, "run", "dev", "--", "--host", "127.0.0.1", "--port", str(args.frontend_port)],
                    cwd=frontend,
                    env=frontend_environment,
                    start_new_session=True,
                )
            )
            print(f"Dashboard: http://localhost:{args.frontend_port}", flush=True)
            print(f"API reference: {base}/docs", flush=True)
            print("Local demo uses .demo/disputeflow.db, demo extraction, and dry-run execution.", flush=True)
            print("Connect the dashboard with the local demo keys documented in README.md.", flush=True)
            print("Press Ctrl+C to stop API, worker, and dashboard. Logs: .demo/logs/", flush=True)
            while True:
                for process in processes:
                    if process.poll() is not None:
                        raise RuntimeError("A demo process exited. Inspect the terminal and .demo/logs/.")
                time.sleep(0.3)
    except KeyboardInterrupt:
        print("\nStopping the local demo.", flush=True)
        return 0
    except (OSError, RuntimeError, URLError) as error:
        print(f"Demo startup failed: {error}", file=sys.stderr)
        return 1
    finally:
        stop_processes(processes)


if __name__ == "__main__":
    raise SystemExit(main())

import argparse
import asyncio
import json
import logging
import os
import signal

from sqlalchemy.exc import OperationalError

from .config import Settings
from .db import Database
from .domain import CaseInput
from .service import Coordinator, analyze


async def worker(settings: Settings, *, once=False):
    database = Database(settings.database_url)
    if settings.environment != "production":
        database.initialize()
    backend = Coordinator(settings, database)
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stopped.set)
    try:
        while not stopped.is_set():
            try:
                processed = await backend.process_one()
            except OperationalError:
                logging.getLogger(__name__).warning(
                    "Worker database unavailable; waiting for migrations or reconnection"
                )
                processed = False
            if once:
                return
            if not processed:
                try:
                    await asyncio.wait_for(stopped.wait(), settings.worker_poll_seconds)
                except TimeoutError:
                    pass
    finally:
        await backend.close()
        database.close()


async def demo(path: str, settings: Settings):
    # Explicit offline mode, independent of the user's live .env credentials.
    settings = Settings(
        _env_file=None,
        llm_provider="demo",
        execution_mode="dry_run",
        policy_dir=settings.policy_dir,
        environment="development",
    )
    backend = Coordinator(settings, Database("sqlite://"))
    try:
        with open(path) as file:
            case = CaseInput.model_validate(json.load(file))
        result = await analyze(case, backend.catalog, backend.extractor, settings)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    finally:
        await backend.close()
        backend.db.close()


def main():
    parser = argparse.ArgumentParser(description="DisputeFlow backend")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve", help="Start API")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=int(os.getenv("PORT", "8000")))
    serve.add_argument("--reload", action="store_true")
    sub.add_parser("init-db", help="Create development database schema")
    work = sub.add_parser("worker", help="Process durable jobs")
    work.add_argument("--once", action="store_true")
    sample = sub.add_parser("demo", help="Print offline reasoning result")
    sample.add_argument("--case", default="examples/unique.json")
    export = sub.add_parser("export-openapi", help="Write OpenAPI JSON")
    export.add_argument("--output", default="openapi.json")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = Settings()
    if args.command == "serve":
        import uvicorn

        uvicorn.run(
            "disputeflow.api:create_app",
            factory=True,
            host=args.host,
            port=args.port,
            reload=args.reload,
        )
    elif args.command == "init-db":
        if settings.environment == "production":
            parser.error("Use alembic upgrade head for production migrations")
        database = Database(settings.database_url)
        database.initialize()
        database.close()
        print("Database initialized")
    elif args.command == "worker":
        asyncio.run(worker(settings, once=args.once))
    elif args.command == "demo":
        asyncio.run(demo(args.case, settings))
    elif args.command == "export-openapi":
        from .api import create_app

        app = create_app(settings)
        with open(args.output, "w") as file:
            json.dump(app.openapi(), file, indent=2)
        asyncio.run(app.state.coordinator.close())
        app.state.coordinator.db.close()


if __name__ == "__main__":
    main()

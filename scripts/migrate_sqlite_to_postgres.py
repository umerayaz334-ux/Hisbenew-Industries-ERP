"""Copy a portable Hisbenew ERP SQLite database into an empty PostgreSQL DB."""

import argparse
import os
import sys
from pathlib import Path

from sqlalchemy import MetaData, create_engine, func, select, text


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        default="/data/hisbenew_industries.db",
        help="Path to the portable SQLite database.",
    )
    parser.add_argument(
        "--target-url",
        default=os.getenv("DATABASE_URL", ""),
        help="PostgreSQL SQLAlchemy URL; defaults to DATABASE_URL.",
    )
    parser.add_argument(
        "--clear-target",
        action="store_true",
        help="Delete existing PostgreSQL data before importing.",
    )
    return parser.parse_args()


def reset_postgres_sequences(connection, tables) -> None:
    if connection.dialect.name != "postgresql":
        return
    for table in tables:
        integer_primary_keys = [
            column
            for column in table.primary_key.columns
            if column.type.python_type is int
        ]
        for column in integer_primary_keys:
            sequence_name = connection.execute(
                text("SELECT pg_get_serial_sequence(:table_name, :column_name)"),
                {"table_name": table.name, "column_name": column.name},
            ).scalar()
            if not sequence_name:
                continue
            maximum = connection.execute(select(func.max(column))).scalar()
            connection.execute(
                text(
                    "SELECT setval(CAST(:sequence_name AS regclass), "
                    ":next_value, :has_rows)"
                ),
                {
                    "sequence_name": sequence_name,
                    "next_value": max(1, int(maximum or 1)),
                    "has_rows": maximum is not None,
                },
            )


def main() -> None:
    args = parse_args()
    source_path = Path(args.source).expanduser().resolve()
    if not source_path.is_file():
        raise SystemExit(f"SQLite source was not found: {source_path}")
    if not args.target_url or args.target_url.startswith("sqlite"):
        raise SystemExit("--target-url must point to PostgreSQL.")

    project_dir = Path(__file__).resolve().parents[1]
    backend_dir = project_dir / "backend"
    if backend_dir.is_dir():
        sys.path.insert(0, str(backend_dir))
    elif (project_dir / "app").is_dir():
        sys.path.insert(0, str(project_dir))

    os.environ["DATABASE_URL"] = args.target_url
    from app.database import (  # pylint: disable=import-outside-toplevel
        Base,
        engine as target_engine,
        ensure_scaling_indexes,
    )
    import app.models  # noqa: F401, pylint: disable=import-outside-toplevel,unused-import

    Base.metadata.create_all(bind=target_engine)
    source_engine = create_engine(f"sqlite:///{source_path.as_posix()}")
    source_metadata = MetaData()
    source_metadata.reflect(bind=source_engine)
    target_metadata = Base.metadata
    target_tables = [
        table
        for table in target_metadata.sorted_tables
        if table.name in source_metadata.tables
    ]

    with target_engine.begin() as target_connection:
        populated = [
            table.name
            for table in target_tables
            if target_connection.execute(
                select(func.count()).select_from(table)
            ).scalar_one()
        ]
        if populated and not args.clear_target:
            raise SystemExit(
                "PostgreSQL already contains ERP data. Re-run with --clear-target "
                "only when replacing that data intentionally."
            )
        if populated:
            preparer = target_connection.dialect.identifier_preparer
            table_names = ", ".join(
                preparer.quote(table.name) for table in reversed(target_tables)
            )
            target_connection.execute(
                text(f"TRUNCATE TABLE {table_names} RESTART IDENTITY CASCADE")
            )

        with source_engine.connect() as source_connection:
            for target_table in target_tables:
                source_table = source_metadata.tables[target_table.name]
                target_columns = {column.name for column in target_table.columns}
                batch = []
                imported = 0
                for row in source_connection.execute(select(source_table)).mappings():
                    batch.append(
                        {key: value for key, value in row.items() if key in target_columns}
                    )
                    if len(batch) >= 500:
                        target_connection.execute(target_table.insert(), batch)
                        imported += len(batch)
                        batch.clear()
                if batch:
                    target_connection.execute(target_table.insert(), batch)
                    imported += len(batch)
                if imported:
                    print(f"Imported {target_table.name}: {imported}")
        reset_postgres_sequences(target_connection, target_tables)

    ensure_scaling_indexes()
    print("SQLite to PostgreSQL migration completed successfully.")


if __name__ == "__main__":
    main()

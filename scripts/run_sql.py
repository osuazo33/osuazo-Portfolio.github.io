"""Run a SQL file against DATABASE_URL and print every result set as a table.

Statements are split on lines that start with `-- @@` (the repo convention), and the
first comment line of each block is printed as its title. The whole file runs in one
transaction; it is committed only with --commit (needed for migrations).

    python scripts/run_sql.py sql/recruiting/05_validation.sql
    python scripts/run_sql.py sql/recruiting/04_simulation_tables.sql --commit
"""
import argparse
import pathlib
import sys

from db import connect


def blocks(text):
    block = []
    for line in text.splitlines():
        if line.startswith("-- @@"):
            yield "\n".join(block)
            block = ["-- " + line[5:].strip()]  # text after "-- @@" becomes the title
        else:
            block.append(line)
    yield "\n".join(block)


def title_of(sql):
    for line in sql.splitlines():
        if line.startswith("--") and line.strip("- "):
            return line.lstrip("- ").strip()
    return ""


def print_table(cols, rows):
    cells = [[("" if v is None else str(v)) for v in r] for r in rows]
    widths = [max([len(c)] + [len(r[i]) for r in cells]) for i, c in enumerate(cols)]
    print("  " + " | ".join(c.ljust(w) for c, w in zip(cols, widths)))
    print("  " + "-+-".join("-" * w for w in widths))
    for r in cells:
        print("  " + " | ".join(v.ljust(w) for v, w in zip(r, widths)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", type=pathlib.Path)
    ap.add_argument("--commit", action="store_true", help="commit instead of rolling back")
    args = ap.parse_args()

    with connect() as conn, conn.cursor() as cur:
        for sql in blocks(args.file.read_text(encoding="utf-8")):
            if not any(l.strip() and not l.strip().startswith("--") for l in sql.splitlines()):
                continue
            title = title_of(sql)
            if title:
                print(f"\n== {title}")
            cur.execute(sql)
            if cur.description:
                print_table([d.name for d in cur.description], cur.fetchall())
            else:
                print(f"  ok ({cur.statusmessage})")
        if args.commit:
            conn.commit()
            print("\ncommitted")
        else:
            conn.rollback()


if __name__ == "__main__":
    sys.exit(main())

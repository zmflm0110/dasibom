"""ClipMind CLI: start | list | search | show | combine | stats"""
import argparse
import sys

from . import store
from .search import semantic_search, keyword_search
from .combine import combine_clips
from .context import suggest as context_suggest


def _preview(text: str, n: int = 70) -> str:
    flat = text.replace("\n", " ")
    return flat[:n] + ("..." if len(flat) > n else "")


def cmd_start(args):
    from . import monitor
    monitor.run(poll_interval=args.interval)


def cmd_list(args):
    conn = store.connect()
    rows = store.list_clips(conn, limit=args.limit, category=args.category)
    if not rows:
        print("(no clips)")
        return
    for r in rows:
        tag = r["category"] + (f"/{r['subtype']}" if r["subtype"] else "")
        print(f"#{r['id']:<5} [{tag:<18}] {r['source_app'] or '?':<15} {_preview(r['content'])}")


def cmd_search(args):
    conn = store.connect()
    if args.keyword:
        rows = keyword_search(conn, args.query, limit=args.top_k)
        for r in rows:
            tag = r["category"] + (f"/{r['subtype']}" if r["subtype"] else "")
            print(f"#{r['id']:<5} [{tag:<18}] {_preview(r['content'])}")
    else:
        results = semantic_search(conn, args.query, top_k=args.top_k, category=args.category)
        if not results:
            print("(no matches)")
            return
        for row, score in results:
            tag = row["category"] + (f"/{row['subtype']}" if row["subtype"] else "")
            print(f"#{row['id']:<5} score={score:.3f} [{tag:<18}] {_preview(row['content'])}")


def cmd_show(args):
    conn = store.connect()
    row = store.get_clip(conn, args.id)
    if not row:
        print(f"no clip #{args.id}", file=sys.stderr)
        sys.exit(1)
    print(row["content"])


def cmd_combine(args):
    conn = store.connect()
    text = combine_clips(conn, args.ids)
    print(text)


def cmd_suggest(args):
    conn = store.connect()
    app_name, category, results, language = context_suggest(conn, query=args.query, top_k=args.top_k)
    ctx = f"app={app_name or '?'}"
    if category:
        ctx += f" -> inferred category={category}"
    if language:
        ctx += f" (language={language})"
    print(f"[context] {ctx}")
    if not results:
        print("(no suggestions)")
        return
    for row, score in results:
        tag = row["category"] + (f"/{row['subtype']}" if row["subtype"] else "")
        print(f"#{row['id']:<5} score={score:.3f} [{tag:<18}] {_preview(row['content'])}")


def cmd_stats(args):
    conn = store.connect()
    s = store.stats(conn)
    print(f"total clips: {s['total']}")
    for cat, count in s["by_category"].items():
        print(f"  {cat:<15} {count}")


def main():
    parser = argparse.ArgumentParser(prog="clipmind")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("start", help="run the clipboard monitor daemon")
    p.add_argument("--interval", type=float, default=0.5)
    p.set_defaults(func=cmd_start)

    p = sub.add_parser("list", help="list recent clips")
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--category", default=None)
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("search", help="semantic or keyword search over clips")
    p.add_argument("query")
    p.add_argument("--top-k", type=int, default=5)
    p.add_argument("--category", default=None)
    p.add_argument("--keyword", action="store_true", help="plain substring search instead of semantic")
    p.set_defaults(func=cmd_search)

    p = sub.add_parser("show", help="print full content of a clip")
    p.add_argument("id", type=int)
    p.set_defaults(func=cmd_show)

    p = sub.add_parser("combine", help="combine multiple clips by id")
    p.add_argument("ids", type=int, nargs="+")
    p.set_defaults(func=cmd_combine)

    p = sub.add_parser("suggest", help="context-aware suggestions based on the frontmost app")
    p.add_argument("query", nargs="?", default=None)
    p.add_argument("--top-k", type=int, default=5)
    p.set_defaults(func=cmd_suggest)

    p = sub.add_parser("stats", help="show clip counts by category")
    p.set_defaults(func=cmd_stats)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

"""
apply_sentiment_from_report.py
─────────────────────────────────────────────────────────────────────
Writes sentiment results from an already-generated test_sentiment_timing.py
JSON report straight into MongoDB — no new Ollama calls, no re-analysis.

Use this when you've already reviewed a report's dry-run results and want
to commit exactly what you saw, rather than re-running the LLM a second
time (which can give a slightly different answer on the same input — the
model isn't perfectly deterministic even at low temperature).

Matches each article by `source_url` (unique in the NewsArticle schema —
the JSON report doesn't store MongoDB's internal `_id`). Any article whose
`sentiment` is null (failed/unparsed in the original run) is skipped, not
written — same rule test_sentiment_timing.py uses, so nothing partial or
garbage ever lands in the DB. Only `sentiment`, `sentiment_target`,
`sentiment_target_alignment`, `sentiment_reasoning` are touched — nothing
else on the article is modified.

SAFE BY DEFAULT — DRY RUN: without --confirm, nothing is written; every
proposed change is printed so you can review before committing.

Usage (run from the Blura-Engine/ folder):
    python apply_sentiment_from_report.py timing_results/<report>.json             # DRY RUN
    python apply_sentiment_from_report.py timing_results/<report>.json --confirm   # LIVE write
"""
import sys
import json
import argparse

from DB.mongo_connect import get_db  # also loads backend/.env as a dotenv fallback

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

_ALLOWED_SENTIMENTS = ('positive', 'negative', 'moderate')


def main():
    parser = argparse.ArgumentParser(
        description='Apply sentiment results from a saved test_sentiment_timing.py JSON report to MongoDB. Dry run unless --confirm is passed.'
    )
    parser.add_argument('report_path', help='Path to a sentiment_timing_*.json report file')
    parser.add_argument('--confirm', action='store_true', help='Actually write to MongoDB. Without this flag, nothing is written.')
    args = parser.parse_args()

    with open(args.report_path, encoding='utf-8') as f:
        report = json.load(f)

    articles = report.get('articles', [])
    if not articles:
        print("No articles found in that report file.")
        return

    col = get_db()['newsarticles']

    print(f"Report  : {args.report_path}")
    print(f"Mode    : {'LIVE -- writing to MongoDB' if args.confirm else 'DRY RUN -- no writes (pass --confirm to write)'}")
    print(f"Articles: {len(articles)}")
    print("-" * 70)

    written = 0
    skipped_invalid = 0
    skipped_no_url = 0
    skipped_no_match = 0

    for a in articles:
        title = (a.get('title') or '')[:70]
        url = a.get('source_url')
        sentiment = a.get('sentiment')

        if sentiment not in _ALLOWED_SENTIMENTS:
            print(f"SKIP (no valid sentiment -- was {sentiment!r} in the report): {title!r}")
            skipped_invalid += 1
            continue
        if not url:
            print(f"SKIP (report has no source_url to match on): {title!r}")
            skipped_no_url += 1
            continue

        update = {
            'sentiment': sentiment,
            'sentiment_target': a.get('dominant_actor') or '',
            'sentiment_target_alignment': a.get('actor_alignment') or '',
            'sentiment_reasoning': a.get('reasoning') or '',
        }
        prev = a.get('previous_sentiment')

        if args.confirm:
            result = col.update_one({'source_url': url}, {'$set': update})
            if result.matched_count == 0:
                print(f"WARN (no article in DB with this source_url -- may have been deleted since): {title!r}")
                skipped_no_match += 1
                continue
            print(f"WROTE: {prev!r} -> {sentiment!r}  {title!r}")
            written += 1
        else:
            print(f"[DRY RUN] would write: {prev!r} -> {sentiment!r}  {title!r}")
            written += 1

    print("-" * 70)
    label = 'Written' if args.confirm else 'Would write'
    print(f"{label}                          : {written}")
    print(f"Skipped (no valid sentiment)     : {skipped_invalid}")
    print(f"Skipped (report missing url)     : {skipped_no_url}")
    if args.confirm:
        print(f"Skipped (no matching DB article) : {skipped_no_match}")


if __name__ == '__main__':
    main()

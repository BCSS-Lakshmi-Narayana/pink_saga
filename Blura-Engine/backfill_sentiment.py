"""
backfill_sentiment.py
─────────────────────────────────────────────────────────────────────
Scores the `sentiment` field (positive / negative / moderate) on EXISTING
news articles that don't have one yet — so old articles match the new ones.

Reuses political_rss.detect_sentiment: Cohere when COHERE_API_KEY is set,
otherwise the keyword heuristic — every article still gets a label.

Safe by default: a DRY RUN just counts. Pass --confirm to write.

Usage (run from the Blura-Engine/ folder):
    python backfill_sentiment.py                  # DRY RUN — how many need scoring
    python backfill_sentiment.py --confirm         # score only articles missing sentiment
    python backfill_sentiment.py --confirm --all    # re-score ALL articles (even already-scored)

Needs Blura-Engine/.env with MONGODB_URI + DB_NAME (and COHERE_API_KEY for LLM scoring).
"""
import sys

from dotenv import load_dotenv
load_dotenv()                    # .env
load_dotenv('.env.political')    # optional override, if present

from DB.mongo_connect import get_db          # noqa: E402
from political_rss import detect_sentiment   # noqa: E402


def main():
    confirm = '--confirm' in sys.argv
    do_all = '--all' in sys.argv

    col = get_db()['newsarticles']
    query = {} if do_all else {
        '$or': [
            {'sentiment': {'$exists': False}},
            {'sentiment': None},
            {'sentiment': ''},
        ]
    }

    total = col.count_documents(query)
    scope = 'ALL articles' if do_all else 'articles missing sentiment'
    print(f"To score: {total}  ({scope})")
    if total == 0:
        print("Nothing to do.")
        return

    if not confirm:
        print("\nDRY RUN — nothing written. Re-run with --confirm to write:")
        print("  python backfill_sentiment.py --confirm" + (" --all" if do_all else ""))
        return

    cursor = col.find(query, {'title': 1, 'title_english': 1, 'summary': 1, 'summary_english': 1, 'content': 1})
    counts = {'positive': 0, 'negative': 0, 'moderate': 0}
    updated = 0
    for a in cursor:
        title = a.get('title_english') or a.get('title') or ''
        summary = a.get('summary_english') or a.get('summary') or ''
        content = a.get('content') or ''
        result = detect_sentiment(title, summary, content)
        sent = result['sentiment']
        col.update_one({'_id': a['_id']}, {'$set': {
            'sentiment': sent,
            'sentiment_target': result['dominant_actor'],
            'sentiment_target_alignment': result['actor_alignment'],
            'sentiment_reasoning': result['reasoning'],
        }})
        counts[sent] = counts.get(sent, 0) + 1
        updated += 1
        if updated % 50 == 0:
            print(f"  {updated}/{total} …")

    print(
        f"\nDone. Updated {updated}. Breakdown: "
        f"{counts['positive']} positive · {counts['moderate']} moderate · {counts['negative']} negative"
    )


if __name__ == '__main__':
    main()

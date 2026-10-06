"""
test_sentiment_timing.py
─────────────────────────────────────────────────────────────────────
Re-runs sentiment analysis on the most recently published articles
already in the DB, using OLLAMA (not Cohere), and prints how long each
call takes plus how many characters of article content were sent — so
the content-length cap used in political_rss.py (_CONTENT_SAFETY_CAP_CHARS)
can be tuned from real numbers instead of guesswork.

SAFE BY DEFAULT — DRY RUN: without --confirm, nothing is written to
MongoDB. Every article's old sentiment (if any) and the newly-computed
one are both printed and saved to the report, so you can review the full
before/after diff before deciding to write anything.

--confirm: writes `sentiment`, `sentiment_target`, `sentiment_target_alignment`,
`sentiment_reasoning` back onto each of the articles processed (only those
4 fields — nothing else on the article is touched, nothing is deleted).
The previous values are captured in the JSON report before being
overwritten, so the change is auditable even though it isn't
auto-reversible.

Ollama config is read from backend/.env (OLLAMA_BASE_URL / OLLAMA_MODEL /
OLLAMA_TIMEOUT_MS) via DB/mongo_connect's existing dotenv loading — the
same config backend/src/services/ollamaLLMService.js uses, and the same
/api/chat request shape, so these timings are representative of what the
Node backend would also see.

Usage (run from the Blura-Engine/ folder):
    python test_sentiment_timing.py                     # DRY RUN, 10 articles, 2500-char cap (default, matches political_rss.py)
    python test_sentiment_timing.py --count 50           # DRY RUN, 50 articles — preview only
    python test_sentiment_timing.py --count 50 --confirm # LIVE — actually updates the 50 articles in MongoDB
    python test_sentiment_timing.py --cap 20000           # test a larger cap (this is what showed a 38% failure rate on Ollama)
"""
import os
import re
import sys
import json
import time
import argparse
from datetime import datetime

# Titles/summaries are frequently Telugu. When stdout isn't an
# interactive UTF-8 console (redirected to a file, piped, or a plain Windows
# console stuck on the cp1252 codepage), Python's default print() encoding
# can't represent those characters and crashes with UnicodeEncodeError before
# a single article finishes. Force UTF-8 on stdout/stderr up front so this
# runs the same way regardless of how/where it's invoked.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, 'reconfigure'):
        _stream.reconfigure(encoding='utf-8', errors='replace')

import requests

from DB.mongo_connect import get_db  # also loads backend/.env as a dotenv fallback

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'timing_results')

# ── Ollama config (mirrors backend/src/services/ollamaLLMService.js) ──────────
# Note: ollamaLLMService.js reads `OLLAMA_URL`, but backend/.env actually
# defines `OLLAMA_BASE_URL` — checking both here so this script picks up
# whichever one is actually set, rather than silently falling back to a
# hardcoded default.
OLLAMA_BASE_URL = (
    os.getenv('OLLAMA_BASE_URL')
    or os.getenv('OLLAMA_URL')
    or 'http://32.192.131.130:11434'
).rstrip('/')
OLLAMA_MODEL = os.getenv('OLLAMA_MODEL', 'qwen2.5:7b')
OLLAMA_TIMEOUT_MS = int(os.getenv('OLLAMA_TIMEOUT_MS', '45000'))

# ── Sentiment prompt ────────────────────────────────────────────────────────
# Deliberately DUPLICATED from political_rss.py's _SENTIMENT_PROMPT_TEMPLATE
# rather than imported — importing political_rss.py pulls in the
# sentence_transformers/torch chain (via its `from DB.mongo_similarity import
# check_duplicate`), which alone can take a minute or more to import and
# would pollute the very timing numbers this script exists to measure.
# KEEP THIS IN SYNC with _SENTIMENT_PROMPT_TEMPLATE in political_rss.py if
# that prompt changes.
# Imported rather than copied: this file previously held its own duplicate of
# the prompt, so when the live one was rewritten for BRS this copy silently
# went on describing the old deployment's camps.
from political_rss import _SENTIMENT_PROMPT_TEMPLATE as SENTIMENT_PROMPT_TEMPLATE


def extract_json(text):
    """Tolerant JSON extraction — same approach as political_rss._extract_json."""
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        pass
    cleaned = re.sub(r'^```(?:json)?\s*|\s*```$', '', text.strip())
    try:
        return json.loads(cleaned)
    except Exception:
        pass
    m = re.search(r'\{[\s\S]*\}', text)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return None
    return None


def call_ollama(prompt, timeout_ms=OLLAMA_TIMEOUT_MS):
    """POST to Ollama's /api/chat — same request shape as
    backend/src/services/ollamaLLMService.js's chatCompletion(), so these
    timings are representative of what the Node backend would also see."""
    body = {
        'model': OLLAMA_MODEL,
        'messages': [
            {
                'role': 'system',
                'content': (
                    'You are a strict JSON generator. Respond with one valid JSON '
                    'object only. No markdown, no code fences, no commentary before '
                    'or after the JSON.'
                ),
            },
            {'role': 'user', 'content': prompt},
        ],
        'stream': False,
        'format': 'json',
        'options': {
            'temperature': 0.1,
            'top_k': 5,
            'top_p': 0.9,
            'num_predict': 350,
        },
    }
    resp = requests.post(
        f'{OLLAMA_BASE_URL}/api/chat',
        json=body,
        timeout=timeout_ms / 1000,
    )
    resp.raise_for_status()
    data = resp.json()
    text = (data.get('message') or {}).get('content') or data.get('response') or ''
    if not text:
        raise RuntimeError(f'Empty/unrecognized Ollama response: {json.dumps(data)[:200]}')
    return text.strip()


def main():
    parser = argparse.ArgumentParser(
        description='Re-run sentiment analysis via Ollama on recent articles. Dry run unless --confirm is passed.'
    )
    parser.add_argument('--count', type=int, default=10, help='How many recent articles to process (default 10)')
    parser.add_argument('--cap', type=int, default=2500, help='Content char cap to test, mirrors _CONTENT_SAFETY_CAP_CHARS in political_rss.py (default 2500 — empirically tuned, see timing_results/ reports)')
    parser.add_argument('--confirm', action='store_true', help='Actually write sentiment/target/alignment/reasoning back to MongoDB. Without this flag, nothing is written.')
    args = parser.parse_args()

    started_at = datetime.now()
    if args.confirm:
        print("=" * 70)
        print("LIVE MODE -- this WILL update MongoDB for every article processed.")
        print("=" * 70)
    else:
        print("DRY RUN -- no database writes. Pass --confirm to actually update MongoDB.")
    print(f"Ollama endpoint : {OLLAMA_BASE_URL}")
    print(f"Ollama model    : {OLLAMA_MODEL}")
    print(f"Content cap     : {args.cap} chars")
    print(f"Articles to test: {args.count}")
    print("-" * 70)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    output_path = os.path.join(
        OUTPUT_DIR,
        f"sentiment_timing_{started_at.strftime('%Y%m%d_%H%M%S')}_cap{args.cap}_n{args.count}.json",
    )

    col = get_db()['newsarticles']
    articles = list(
        col.find({}, {
            'title': 1, 'title_english': 1, 'summary': 1, 'summary_english': 1,
            'content': 1, 'published_date': 1, 'source_name': 1, 'source_url': 1,
            'sentiment': 1, 'sentiment_target': 1, 'sentiment_target_alignment': 1,
            'sentiment_reasoning': 1,
        })
        .sort('published_date', -1)
        .limit(args.count)
    )

    if not articles:
        print("No articles found in the DB.")
        return

    def save(results_so_far, finished):
        """Write/overwrite the JSON report — called after every article, not
        just at the end, so an interrupted run (Ctrl+C, a hung Ollama call)
        still leaves a usable file with whatever completed so far."""
        times = [r['elapsed_sec'] for r in results_so_far if not r['error']]
        report = {
            'run': {
                'started_at': started_at.isoformat(),
                'finished_at': datetime.now().isoformat() if finished else None,
                'finished': finished,
                'mode': 'LIVE — DB UPDATED' if args.confirm else 'DRY RUN — no DB writes',
                'ollama_endpoint': OLLAMA_BASE_URL,
                'ollama_model': OLLAMA_MODEL,
                'ollama_timeout_ms': OLLAMA_TIMEOUT_MS,
                'content_cap_chars': args.cap,
                'articles_requested': args.count,
                'articles_found': len(articles),
                'articles_completed': len(results_so_far),
            },
            'summary': {
                'successful_calls': len(times),
                'failed_or_unparsed': len(results_so_far) - len(times),
                'updated_in_db': sum(1 for r in results_so_far if r.get('updated_in_db')),
                'sentiment_changed': sum(1 for r in results_so_far if r.get('sentiment') != r.get('previous_sentiment')),
                'avg_elapsed_sec': round(sum(times) / len(times), 2) if times else None,
                'min_elapsed_sec': round(min(times), 2) if times else None,
                'max_elapsed_sec': round(max(times), 2) if times else None,
            },
            'articles': results_so_far,
        }
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, ensure_ascii=False)

    results = []
    for i, a in enumerate(articles, start=1):
        title = a.get('title_english') or a.get('title') or ''
        summary = a.get('summary_english') or a.get('summary') or ''
        content = (a.get('content') or '')[:args.cap]

        prompt = SENTIMENT_PROMPT_TEMPLATE.format(
            title=title or '(no headline)',
            summary=summary or '(no summary)',
            content=content or '(no article body available)',
        )

        print(f"[{i}/{len(articles)}] {title[:70]!r}  (content: {len(content)} chars, prompt: {len(prompt)} chars)")

        t0 = time.perf_counter()
        error = None
        parsed = None
        raw = None
        try:
            raw = call_ollama(prompt)
            parsed = extract_json(raw)
        except Exception as e:
            error = str(e)
        elapsed = time.perf_counter() - t0

        if error:
            print(f"    ERROR after {elapsed:.2f}s: {error}")
        elif not parsed:
            print(f"    {elapsed:.2f}s -- could not parse JSON from response")
        else:
            print(
                f"    {elapsed:.2f}s -- sentiment={parsed.get('sentiment')!r} "
                f"target={parsed.get('dominant_actor')!r} alignment={parsed.get('actor_alignment')!r}"
            )

        new_sentiment = parsed.get('sentiment') if parsed else None
        if new_sentiment == 'neutral':
            new_sentiment = 'moderate'  # same mapping as political_rss.detect_sentiment
        _ALLOWED = ('positive', 'negative', 'moderate')
        can_write = new_sentiment in _ALLOWED  # never write a partial/garbage result

        prev_sentiment = a.get('sentiment')
        prev_target = a.get('sentiment_target')
        prev_alignment = a.get('sentiment_target_alignment')
        prev_reasoning = a.get('sentiment_reasoning')

        updated_in_db = False
        if args.confirm and can_write:
            col.update_one(
                {'_id': a['_id']},
                {'$set': {
                    'sentiment': new_sentiment,
                    'sentiment_target': parsed.get('dominant_actor') or '',
                    'sentiment_target_alignment': parsed.get('actor_alignment') or '',
                    'sentiment_reasoning': parsed.get('reasoning') or '',
                }},
            )
            updated_in_db = True
            print(f"    DB UPDATED: sentiment {prev_sentiment!r} -> {new_sentiment!r}")
        elif args.confirm and not can_write:
            print(f"    DB NOT updated -- no valid sentiment to write (error/unparsed)")
        else:
            changed = prev_sentiment != new_sentiment
            print(f"    [DRY RUN] would set sentiment {prev_sentiment!r} -> {new_sentiment!r}{' (CHANGED)' if changed else ' (same)'}")

        results.append({
            'index': i,
            'title': title,
            'source_name': a.get('source_name') or '',
            'source_url': a.get('source_url') or '',
            'published_date': a.get('published_date').isoformat() if a.get('published_date') else None,
            'content_chars': len(content),
            'prompt_chars': len(prompt),
            'elapsed_sec': round(elapsed, 2),
            'error': error,
            'sentiment': new_sentiment,
            'dominant_actor': parsed.get('dominant_actor') if parsed else None,
            'actor_alignment': parsed.get('actor_alignment') if parsed else None,
            'reasoning': parsed.get('reasoning') if parsed else None,
            'raw_response': raw,
            'previous_sentiment': prev_sentiment,
            'previous_sentiment_target': prev_target,
            'previous_sentiment_target_alignment': prev_alignment,
            'previous_sentiment_reasoning': prev_reasoning,
            'updated_in_db': updated_in_db,
        })

        # Save after every article, not just at the end, so a Ctrl+C or a
        # hung Ollama call on article N still leaves 1..N-1 on disk.
        save(results, finished=False)

    save(results, finished=True)
    print(f"\nDetailed report saved to: {output_path}")
    print("-" * 70)
    times = [r['elapsed_sec'] for r in results if not r['error']]
    changed = sum(1 for r in results if r['sentiment'] != r['previous_sentiment'])
    updated = sum(1 for r in results if r['updated_in_db'])
    if times:
        print(f"Successful calls : {len(times)}/{len(results)}")
        print(f"Avg time         : {sum(times) / len(times):.2f}s")
        print(f"Min / Max time   : {min(times):.2f}s / {max(times):.2f}s")
    else:
        print("No successful calls -- check Ollama connectivity/model name.")
    print(f"Sentiment changed: {changed}/{len(results)} (old value differs from new)")
    if args.confirm:
        print(f"Written to DB    : {updated}/{len(results)}")
    else:
        print("Written to DB    : 0 (DRY RUN — re-run with --confirm to write)")

    print("\n#   Time(s)  ContentChars  PromptChars  Sentiment    Title")
    for i, r in enumerate(results, start=1):
        status = r['sentiment'] or ('ERROR' if r['error'] else 'unparsed')
        print(f"{i:<3} {r['elapsed_sec']:<8} {r['content_chars']:<13} {r['prompt_chars']:<12} {status:<12} {r['title'][:70]}")


if __name__ == '__main__':
    main()

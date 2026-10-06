"""
backfill_content.py
─────────────────────────────────────────────────────────────────────
Re-fetches CONTENT + IMAGE for existing Google-News articles that were saved
headline-only (before the URL-decode fix). For each, it resolves the stored
Google News link to the real article and scrapes it, updating the record in
place — no articles are deleted.

Reuses political_rss.resolve_google_news_url + fetch_article_page.

Safe by default: a DRY RUN just counts. Pass --confirm to write.

Usage (run from the Blura-Engine/ folder):
    python backfill_content.py            # DRY RUN — how many need content
    python backfill_content.py --confirm   # resolve + scrape + update in place

Needs Blura-Engine/.env (or backend/.env) with MONGODB_URI + DB_NAME.
"""
import sys
from urllib.parse import urlparse

from dotenv import load_dotenv
load_dotenv()
load_dotenv('.env.political')

from DB.mongo_connect import get_db                                           # noqa: E402
from political_rss import resolve_google_news_url, fetch_article_page, DEFAULT_IMAGE_URL  # noqa: E402


def main():
    confirm = '--confirm' in sys.argv
    col = get_db()['newsarticles']

    # Google-News-sourced articles that never got real content scraped.
    query = {
        'source_url': {'$regex': 'news.google.com'},
        '$or': [
            {'content': {'$in': [None, '']}},
            {'source_domain': {'$in': [None, '']}},
        ],
    }

    total = col.count_documents(query)
    print(f"Google-News articles needing content/image: {total}"
          + ('' if confirm else '   (DRY RUN)'))
    if total == 0:
        print("Nothing to do.")
        return
    if not confirm:
        print("\nDRY RUN — nothing written. Re-run with --confirm to update:")
        print("  python backfill_content.py --confirm")
        return

    cursor = col.find(query, {'source_url': 1, 'image_url': 1})
    updated = got_content = got_image = failed = 0
    for a in cursor:
        real = resolve_google_news_url(a.get('source_url', ''))
        if not real:
            failed += 1
            continue
        page = fetch_article_page(real)
        upd = {'source_domain': urlparse(real).netloc.replace('www.', '')}
        if page.get('content'):
            upd['content'] = page['content']
            got_content += 1
        cur_img = a.get('image_url')
        if page.get('image') and (not cur_img or cur_img == DEFAULT_IMAGE_URL):
            upd['image_url'] = page['image']
            got_image += 1
        col.update_one({'_id': a['_id']}, {'$set': upd})
        updated += 1
        if updated % 25 == 0:
            print(f"  {updated}/{total} …")

    print(f"\nDone. Updated {updated} articles "
          f"(content: {got_content}, image: {got_image}, unresolved: {failed}).")


if __name__ == '__main__':
    main()

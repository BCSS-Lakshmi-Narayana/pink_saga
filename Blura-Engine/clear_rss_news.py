"""
Deletes ALL documents from the newsarticles collection.
Run this to wipe the RSS news cache before a fresh scrape.
Usage: python clear_rss_news.py --yes
"""
import sys

from DB.mongo_connect import get_db, get_news_collection

if '--yes' not in sys.argv:
    print(f"This deletes EVERY article in {get_db().name}.newsarticles. Re-run with --yes to confirm.")
    sys.exit(1)

col = get_news_collection()
result = col.delete_many({})
print(f"[DONE] Deleted {result.deleted_count} articles from newsarticles collection.")

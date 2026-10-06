"""
Resets the RSS keyword list to the defaults in newsController.js: deletes every
rsskeywords document and the one-time seed marker, so the backend re-seeds the
defaults the next time the Keywords modal is opened. Keywords added through the
UI are deleted too.
Usage: python reset_config_keywords.py --yes
"""
import sys

from DB.mongo_connect import get_db

db = get_db()
if '--yes' not in sys.argv:
    print(f"This deletes every keyword in {db.name}.rsskeywords (including UI-added ones). Re-run with --yes.")
    sys.exit(1)

result = db['rsskeywords'].delete_many({})
db['rsskeywords_meta'].delete_one({'_id': 'seed'})
print(f"[DONE] Deleted {result.deleted_count} keywords and the seed marker from {db.name}.")
print("Open the Keywords modal in the UI to re-seed the defaults from newsController.js.")

import os
from pymongo import MongoClient
from dotenv import load_dotenv

# Try parent folder's .env.political
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env.political'))
# Try backend's .env as fallback
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'backend', '.env'))

MONGODB_URI = os.getenv('MONGODB_URI', 'mongodb://localhost:27017')
DB_NAME = os.getenv('DB_NAME')

if not DB_NAME:
    try:
        # Extract DB name from MONGODB_URI
        path_part = MONGODB_URI.split('/')[-1]
        DB_NAME = path_part.split('?')[0] or 'test'
    except Exception:
        DB_NAME = 'test'

_client = None

def get_db():
    global _client
    if _client is None:
        _client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
    return _client[DB_NAME]

def get_news_collection():
    return get_db()['newsarticles']

"""
UNPLUGGED — nothing imports this module, and nothing should import it at module
scope as it was originally written.

WHY IT IS UNPLUGGED
-------------------
`check_duplicate` was imported by political_rss.py but never actually called.
The import alone cost the engine ~694MB resident: sentence_transformers pulls in
torch, and the torch installed in this venv is the CUDA build (2.13.0+cu130) on a
box with no GPU and no CUDA driver, so cuBLAS / cuDNN / libtorch_cuda all get
mapped in at import time (87 such mappings counted in the live engine
process; 2.7GB of nvidia wheels + 1.2GB of torch on disk). Measured in this venv:
scraping libs alone 35MB, with sentence_transformers 729MB. The model itself
never even loaded — `_model` stayed None for the process's whole life, so that
memory bought nothing.

Deduplication is NOT lost by unplugging this. Two real dedup layers remain and
are untouched:
  1. political_rss.py skips any entry whose exact `title` is already in
     `newsarticles`, before the costly page fetch.
  2. DB/mongo_insert.py::upsert_article upserts on `source_url` with
     `$setOnInsert`, so the same article URL is never inserted twice.
What is gone is *semantic* near-duplicate detection across differently-worded
titles — which was never running in the first place.

IF YOU WANT TITLE DEDUP BACK, DO NOT JUST RE-ADD THE IMPORT
-----------------------------------------------------------
Two things are wrong with the implementation below:

1. all-mpnet-base-v2 is English-primary. This corpus is majority Telugu, and
   English-primary models do not degrade gracefully on Telugu script, they
   collapse. Dedup on Telugu titles here would be close to noise.
2. The loop re-encodes all 300 recent titles for EVERY new article — 300 forward
   passes per article instead of one batch.

Point it at the Ollama host the backend already uses (OLLAMA_BASE_URL, bge-m3)
via POST /api/embeddings, batch the recent titles in one call, and better still
store the embedding on the document at insert time so it is never recomputed.
That keeps torch out of this process entirely.

The sentence_transformers import below is deliberately kept INSIDE the functions
that need it, so that merely importing this module can never reintroduce the
~694MB regression. Behaviour of check_duplicate is otherwise unchanged.
"""

from datetime import datetime, timedelta
from DB.mongo_connect import get_news_collection

_model = None

def _get_model():
    global _model
    if _model is None:
        # Imported lazily — see module docstring. This is the line that drags in
        # torch + the CUDA runtime, so it must not run at import time.
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer('all-mpnet-base-v2')
    return _model

def check_duplicate(title: str, hours: int = 24, threshold: float = 0.78) -> bool:
    """Return True if a semantically similar title exists in the last `hours` hours."""
    if not title or len(title.strip()) < 10:
        return False

    col = get_news_collection()
    since = datetime.utcnow() - timedelta(hours=hours)

    recent = list(col.find(
        {'scraped_at': {'$gte': since}},
        {'title_english': 1, 'title': 1, '_id': 0},
    ).limit(300))

    if not recent:
        return False

    from sentence_transformers import util   # lazy — see module docstring

    model = _get_model()
    enc_new = model.encode(title, convert_to_tensor=True)

    for doc in recent:
        existing = doc.get('title_english') or doc.get('title') or ''
        if not existing:
            continue
        enc_existing = model.encode(existing, convert_to_tensor=True)
        sim = util.pytorch_cos_sim(enc_new, enc_existing).item()
        if sim >= threshold:
            print(f"[DUP] score={sim:.2f} — '{title[:60]}' ~ '{existing[:60]}'")
            return True

    return False

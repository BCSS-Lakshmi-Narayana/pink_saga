import re
from datetime import datetime
from DB.mongo_connect import get_news_collection

# ── Encoding repair ───────────────────────────────────────────────────────────
#
# UTF-8 bytes decoded as Latin-1 leave a very specific signature. Every Telugu
# character (U+0C00-U+0C7F) encodes to bytes E0 B0/B1 xx, which read back as
# Latin-1 become 'à°' / 'à±'; Devanagari gives 'à¤', and smart punctuation
# gives 'â€™' / 'â€œ'. Any of these means something upstream decoded the page
# with the wrong charset — most often Python `requests`, which falls back to
# ISO-8859-1 when a text/* response carries no charset (RFC 2616).
#
# Repairing here rather than at each fetch site means every writer of
# `newsarticles` is covered, including backfill scripts.

_MOJIBAKE_SIGNATURE = re.compile(r'à[°±¤¥¦§¨©ª¬­®¯]|â€[™œ\x9d\x9c]|Ã[\x80-\xbf]')

_TEXT_FIELDS = (
    'title', 'title_english', 'summary', 'summary_english',
    'content', 'source_name', 'sentiment_reasoning',
)


def fix_mojibake(text):
    """Undo one round of UTF-8-read-as-Latin-1 corruption.

    Encoding back to Latin-1 and decoding as UTF-8 is an exact inverse, so the
    original characters return byte-for-byte. Text without the signature, or
    that fails to round-trip, is returned untouched — this must never damage
    text that was already correct.
    """
    if not isinstance(text, str) or not text:
        return text
    if not _MOJIBAKE_SIGNATURE.search(text):
        return text
    try:
        repaired = text.encode('latin-1').decode('utf-8')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text          # not really mojibake, or mixed encodings
    # Accept only if the repair actually cleared the signature.
    return repaired if not _MOJIBAKE_SIGNATURE.search(repaired) else text


def repair_article_encoding(article: dict) -> dict:
    """Apply fix_mojibake to every human-readable field of an article."""
    for field in _TEXT_FIELDS:
        if field in article:
            article[field] = fix_mojibake(article[field])
    return article


def upsert_article(article: dict) -> bool:
    """Insert article if source_url not already present. Returns True if newly inserted."""
    if not article.get('source_url'):
        return False

    # Last line of defence: never persist mis-decoded text.
    article = repair_article_encoding(article)

    col = get_news_collection()
    col.create_index([("published_date", -1)])

    article.setdefault('scraped_at', datetime.utcnow())

    result = col.update_one(
        {'source_url': article['source_url']},
        {'$setOnInsert': article},
        upsert=True,
    )
    inserted = result.upserted_id is not None
    if inserted:
        print(f"[INSERT] {article.get('source_name', '?')} — {article.get('title', '')[:80]}")
    return inserted

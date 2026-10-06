"""
Political News Engine — main entry point.
Runs RSS scraping every 5 minutes.
Usage:  python political_main.py
        python political_main.py --once   (single run, no scheduler)
"""

import sys
import time
import schedule
from datetime import datetime

from political_rss import run_all_feeds

def run():
    print(f"\n{'='*60}")
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Starting Political news scrape...")
    print('='*60)
    run_all_feeds()

if __name__ == '__main__':
    if '--once' in sys.argv:
        run()
    else:
        print("[SCHEDULER] Political engine started. Running every 5 minutes.")
        print("[SCHEDULER] Press Ctrl+C to stop.\n")

        run()  # immediate first run

        schedule.every(5).minutes.do(run)

        while True:
            schedule.run_pending()
            time.sleep(60)

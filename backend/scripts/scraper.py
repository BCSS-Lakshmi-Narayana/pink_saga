import sys
import json
import time
import os
import datetime
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
from bs4 import BeautifulSoup

def setup_driver(session_dir):
    chrome_options = Options()
    # chrome_options.add_argument("--headless=new") # Uncomment for headless in production
    chrome_options.add_argument("--no-sandbox")
    # Stability flags
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--disable-gpu")
    # chrome_options.add_argument("--headless=new") # Enable Headless for stability
    # chrome_options.add_argument("--remote-debugging-port=9222") # Fixed port can cause conflict if multiple instances
    
    # Crucial: Use the same session directory as the manual login
    if session_dir:
        # print(f"Using session dir: {session_dir}", file=sys.stderr)
        chrome_options.add_argument(f"user-data-dir={session_dir}")

    # Retry logic for driver creation (Profile locking issues)
    max_retries = 3
    for i in range(max_retries):
        try:
            # print(f"Installing/Launching Chrome Driver (Attempt {i+1})...", file=sys.stderr)
            service = Service(ChromeDriverManager().install())
            driver = webdriver.Chrome(service=service, options=chrome_options)
            # print("Driver launched successfully.", file=sys.stderr)
            return driver
        except Exception as e:
            print(f"Driver launch failed (Attempt {i+1}): {e}", file=sys.stderr)
            time.sleep(5) # Wait for lock release
            if i == max_retries - 1:
                raise e # Fail after last retry

def scrape_profile(driver, handle):
    url = f"https://x.com/{handle}"
    print(f"Navigating to {url}...", file=sys.stderr)
    driver.get(url)

    # Wait for timelines
    try:
        WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.XPATH, "//article"))
        )
    except:
        # print("Timeout waiting for articles", file=sys.stderr)
        return []

    # Dynamic scroll logic: Scroll until reliable max limit or date cutoff
    cutoff_date = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=48)
    last_height = driver.execute_script("return document.body.scrollHeight")
    scroll_attempts = 0
    
    for _ in range(30): # Max 30 scrolls
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(2)
        
        # Stop if we hit old tweets
        try:
            times = driver.find_elements(By.TAG_NAME, "time")
            if times:
                last_dt = datetime.datetime.fromisoformat(times[-1].get_attribute("datetime").replace('Z', '+00:00'))
                if last_dt < cutoff_date: break
        except: pass
            
        # Stop if page stops growing (with retries for lag)
        new_height = driver.execute_script("return document.body.scrollHeight")
        if new_height == last_height:
            scroll_attempts += 1
            if scroll_attempts >= 3: break
        else:
            last_height = new_height
            scroll_attempts = 0

    # Parse with BS4
    soup = BeautifulSoup(driver.page_source, "html.parser")
    articles = soup.find_all("article")
    
    tweets = []
    for article in articles:
        try:
            # Time & Filter
            time_tag = article.find("time")
            created_at = time_tag["datetime"] if time_tag else datetime.datetime.now().isoformat()
            
            # Filter Logic: Skip posts older than 48h
            try:
                tweet_dt = datetime.datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                if tweet_dt < cutoff_date: continue 
            except: pass

            # Text
            text_div = article.find("div", attrs={"data-testid": "tweetText"})
            text = text_div.get_text(separator="\n").strip() if text_div else ""
            
            # Link/ID
            link_tag = article.find("a", href=lambda h: h and "/status/" in h)
            if link_tag:
                tweet_url = f"https://x.com{link_tag['href']}"
                tweet_id = link_tag['href'].split('/')[-1]
            else:
                tweet_id = f"unknown_{int(time.time()*1000)}"
                tweet_url = ""

            # Metrics
            replies = article.find("div", attrs={"data-testid": "reply"})
            retweets = article.find("div", attrs={"data-testid": "retweet"})
            likes = article.find("div", attrs={"data-testid": "like"})
            
            metrics = {
                "reply": replies.get_text() if replies else "0",
                "retweet": retweets.get_text() if retweets else "0",
                "like": likes.get_text() if likes else "0",
                "views": "0"
            }

            tweets.append({
                "id": tweet_id,
                "text": text,
                "url": tweet_url,
                "created_at": created_at,
                "metrics": metrics
            })
        except Exception as e:
            continue
            
    return tweets

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: scraper.py <username> <target_handle>")
        sys.exit(1)

    username = sys.argv[1] # Account username (for session)
    target_handle = sys.argv[2].replace('@', '') # Target to scrape

    # Path to session
    # Adjust path relative to where script is run (backend root)
    session_path = os.path.abspath(f"sessions/{username}")
    
    try:
        driver = setup_driver(session_path)
        tweets = scrape_profile(driver, target_handle)
        
        if not tweets:
             driver.save_screenshot(f"debug_empty_{target_handle}.png")

        print(json.dumps(tweets))
    except Exception as e:
        print(f"Error in main: {e}", file=sys.stderr)
        print("[]") # Return empty list on crash
        try:
            driver.save_screenshot("debug_crash.png")
        except:
            pass
    finally:
        # Give time for file handles to release
        time.sleep(2)
        try:
            if 'driver' in locals():
                driver.quit()
        except:
            pass


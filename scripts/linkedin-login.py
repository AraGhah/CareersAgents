# Signs in to LinkedIn in the bot's own Chrome profile (C:\temp\auto-job-apply-profile) and waits until it is done.
# Run by scripts/linkedin-bot.ts with the bot's Python, from tools/linkedin-bot, before every run:
# already signed in, it closes at once; otherwise you sign in (with any verification code) in the window it opens.
# Signed in means LinkedIn's session cookie (li_at) is set and the page is no longer a login or checkpoint page.

import sys
import time

from selenium.common.exceptions import NoSuchWindowException, WebDriverException

from modules.open_chrome import driver  # same profile and driver as the bot

TIMEOUT_SECONDS = 15 * 60
NOT_YET = ("/login", "/checkpoint", "/uas/", "/authwall", "/signup")


def signed_in() -> bool:
    url = driver.current_url
    return bool(driver.get_cookie("li_at")) and "linkedin.com" in url and not any(p in url for p in NOT_YET)


try:
    driver.get("https://www.linkedin.com/feed/")
    settle = time.time() + 30  # the feed can take a few seconds to load, or to redirect to the login page
    while not signed_in() and time.time() < settle:
        time.sleep(1)
    if signed_in():
        print("Already signed in.", flush=True)
    else:
        has_cookie = bool(driver.get_cookie("li_at"))
        print(f"Not signed in yet (page: {driver.current_url.split('?')[0]}, session cookie: {'yes' if has_cookie else 'no'}).", flush=True)
        if "/login" not in driver.current_url and "/checkpoint" not in driver.current_url:
            driver.get("https://www.linkedin.com/login")
        print("\n>>> Sign in to LinkedIn in the Chrome window (finish any verification code). Waiting...\n", flush=True)
        deadline = time.time() + TIMEOUT_SECONDS
        while not signed_in():
            if time.time() > deadline:
                print("Not signed in after 15 minutes. Run it again when you are ready.", flush=True)
                sys.exit(2)
            time.sleep(2)
        time.sleep(3)  # let LinkedIn finish writing its cookies to the profile
    print("Signed in to LinkedIn.", flush=True)
except (NoSuchWindowException, WebDriverException) as e:
    print(f"The Chrome window was closed before sign-in finished; keep it open until this says \"Signed in\". ({type(e).__name__})", flush=True)
    sys.exit(3)
finally:
    try:
        driver.quit()
    except Exception:
        pass

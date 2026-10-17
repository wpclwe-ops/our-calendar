"""Manual browser regression against an isolated synthetic server.

Run with requirements-dev + Playwright and an installed Chromium headless shell.
No production URL or real Telegram credentials are used.
"""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request
from playwright.async_api import async_playwright,expect

ROOT=Path(__file__).resolve().parents[1]

async def check(output):
    async with async_playwright() as p:
        executable=os.getenv('QA_CHROMIUM')
        browser=await p.chromium.launch(headless=True,**({'executable_path':executable} if executable else {}),args=['--no-sandbox'])
        context=await browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1,timezone_id='Europe/Warsaw')
        page=await context.new_page();errors=[];failures=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('response',lambda r:failures.append({'status':r.status,'url':r.url}) if r.status>=400 else None)
        await page.route('https://telegram.org/**',lambda route:route.fulfill(status=200,body=''))
        await page.goto('http://127.0.0.1:8123');await page.wait_for_selector('.fab')
        await page.locator('.fab').click();await page.locator('[name=title]').fill('QA второй вторник')
        await page.locator('[name=start]').fill('2026-10-13T12:00');await page.locator('[name=end]').fill('2026-10-13T13:00')
        await page.locator('[name=repeat]').select_option('MONTHLY')
        await page.locator('[name=repeat-month-mode]').select_option('ordinal')
        await page.locator('[name=repeat-ordinal]').select_option('2');await page.locator('[name=repeat-weekday]').select_option('TU')
        await page.locator('[name=repeat-end]').select_option('count');await page.locator('[name=repeat-count]').fill('4');await page.locator('[name=repeat-count]').dispatch_event('change')
        await page.screenshot(path=str(output/'recurrence.png'),full_page=True)
        await page.locator('.header-save').click();await page.wait_for_selector('.event-detail')
        await page.get_by_role('button',name='Другие даты серии').click();await page.locator('.occurrence-picker input').fill('2026-11')
        await page.locator('.occurrence-results button').wait_for();await page.locator('.occurrence-results button').first.click()
        await expect(page.locator('.detail-block strong').first).to_contain_text('10 нояб')
        await page.locator('[data-action=edit-event]').first.click();await page.locator('[data-choice=following]').click()
        await page.locator('[name=title]').fill('QA последующие');await page.locator('.header-save').click()
        await expect(page.locator('.detail-title')).to_have_text('QA последующие')
        saved=await page.evaluate("async () => await api('events?start=2026-10-01&end=2027-04-01')")
        assert len([e for e in saved if e['title'].startswith('QA')])==4
        await page.locator('[data-action=back]').first.click();await page.locator('[data-action=search]').click()
        await page.locator('#search').fill('QA последующие');await expect(page.locator('.event')).to_have_count(1)
        await expect(page.locator('.event')).to_contain_text('QA последующие');await page.locator('.event').first.click();await page.wait_for_selector('.event-detail')
        await page.locator('[data-action=back]').first.click();await page.locator('[data-action=tab][data-tab=settings]').first.click()
        await page.wait_for_selector('[name=setting-language]')
        await page.screenshot(path=str(output/'settings.png'),full_page=True)
        await expect(page.locator('#app')).to_contain_text('Состояние сервиса')
        await page.locator('[name=setting-language]').select_option('en');await page.locator('[data-action=theme][data-theme=dark]').click()
        await page.screenshot(path=str(output/'settings-dark.png'),full_page=True)
        assert await page.evaluate('() => document.documentElement.scrollWidth<=innerWidth')
        await page.set_viewport_size({'width':1280,'height':900});assert await page.evaluate('() => document.documentElement.scrollWidth<=innerWidth')
        print(json.dumps({'errors':errors,'failed_responses':failures,'recurrence':'saved','split':'opened new series','instance_picker':'November 10','search':'passed','settings':'passed','themes_and_widths':'passed'},ensure_ascii=False))
        assert not errors and not failures
        await browser.close()

def main():
    output=Path(os.getenv('QA_OUTPUT',str(ROOT/'test-results'/'ui')));output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory() as data:
        env={**os.environ,'DEMO_MODE':'true','DATABASE_PATH':data+'/calendar.sqlite3','ARCHIVE_KEY_FILE':data+'/key.pem','ARCHIVE_PUBLIC_KEYS':data+'/keys.json','AUTO_SETUP_BOT':'false','HOST':'127.0.0.1','PORT':'8123'}
        subprocess.run([sys.executable,'-m','scripts.demo_seed'],cwd=ROOT,env=env,check=True)
        server=subprocess.Popen([sys.executable,'-m','app'],cwd=ROOT,env=env,stdout=subprocess.DEVNULL)
        try:
            for _ in range(100):
                try:
                    urllib.request.urlopen('http://127.0.0.1:8123/api/config',timeout=1).close();break
                except OSError:time.sleep(.05)
            asyncio.run(check(output))
        finally:server.terminate();server.wait(timeout=10)
if __name__=='__main__':main()

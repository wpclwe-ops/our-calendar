// Inside Telegram the app must disable vertical-swipe minimise and stop page rubber-banding.
const {chromium}=require('playwright');
const {spawn,spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const stub="window.Telegram={WebApp:{initData:'',initDataUnsafe:{},version:'8.0',platform:'ios',isExpanded:true,ready(){},expand(){},close(){},isVersionAtLeast:()=>true,disableVerticalSwipes(){window.__verticalSwipesDisabled=true},HapticFeedback:{impactOccurred(){},selectionChanged(){},notificationOccurred(){}},openTelegramLink(){}}};";
(async()=>{
 const dir=mkdtempSync(join(tmpdir(),'calendar-swipes-'));
 const env={...process.env,DEMO_MODE:'true',OPENAI_API_KEY:'',AUTO_SETUP_BOT:'false',DATABASE_PATH:join(dir,'db.sqlite3'),ARCHIVE_KEY_FILE:join(dir,'key.pem'),ARCHIVE_PUBLIC_KEYS:join(dir,'keys.json'),PORT:'8024'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.on('exit',c=>reject(Error('server exit '+c)))});
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Warsaw'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://telegram.org/**',r=>r.fulfill({contentType:'application/javascript',body:stub}));
  await page.goto('http://127.0.0.1:8024');await page.waitForSelector('.fab');await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>window.__verticalSwipesDisabled),true,'disableVerticalSwipes was not called');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).overscrollBehaviorY),'none');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).overscrollBehaviorY),'none');
  assert.deepEqual(errors,[]);console.log('PASS: vertical swipes disabled and page overscroll none');
 }finally{await browser?.close();server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});

// PF-4: the 15 s poll must not re-render when nothing changed or while the user touches/scrolls.
const {chromium}=require('playwright');
const {spawn,spawnSync}=require('node:child_process');const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');const {tmpdir}=require('node:os');const {join}=require('node:path');
(async()=>{
 const directory=mkdtempSync(join(tmpdir(),'calendar-poll-idle-'));
 const env={...process.env,DEMO_MODE:'true',DATABASE_PATH:join(directory,'calendar.sqlite3'),ARCHIVE_KEY_FILE:join(directory,'archive-key.pem'),ARCHIVE_PUBLIC_KEYS:join(directory,'archive-public-keys.json'),PORT:'8023'};
 assert.equal(spawnSync('python',['-m','scripts.demo_seed'],{env}).status,0);
 const server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});let browser;
 try{
 await new Promise((resolve,reject)=>{server.stderr.on('data',d=>{if(String(d).includes('Uvicorn running'))resolve()});server.on('exit',c=>reject(new Error('server exit '+c)))});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Warsaw'}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://telegram.org/**',r=>r.abort());
 await page.clock.install({time:new Date('2026-10-16T09:00:00Z')});await page.goto('http://127.0.0.1:8023');
 await page.waitForSelector('.timeline');
 const poll=async()=>{await page.clock.runFor(15500);await page.waitForTimeout(700)};
 const mark=()=>page.evaluate(()=>{document.querySelector('.timeline').__mark=1;document.querySelector('.bottom-nav').__mark=1;window.__cache=navigationCache.size});
 const marked=()=>page.evaluate(()=>[Boolean(document.querySelector('.timeline')?.__mark),Boolean(document.querySelector('.bottom-nav')?.__mark),navigationCache.size>=window.__cache]);
 const has=text=>page.evaluate(text=>document.body.textContent.includes(text),text);
 await page.waitForTimeout(500);await mark();
 // Idle: nothing changed, so nodes and the prefetch cache survive several polls.
 await poll();await poll();
 assert.deepEqual(await marked(),[true,true,true]);
 // A touch held down defers the poll even when data changed.
 const id=await page.evaluate(()=>api('events','POST',{title:'Poll visible',start:'2026-10-16T12:00',end:'2026-10-16T13:00',timezone:'Europe/Warsaw',owner:'both'}).then(e=>e.id));
 const cdp=await context.newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:200,y:500}]});await poll();
 assert.equal(await has('Poll visible'),false);
 assert.deepEqual((await marked()).slice(0,2),[true,true]);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await page.waitForTimeout(700);
 // A scroll inside an inner container just before the poll defers it; the next quiet poll applies the change.
 for(let i=0;i<64;i++){await page.evaluate(i=>{document.querySelector('.timeline').scrollTop=40+i%2*20},i);await page.waitForTimeout(40);await page.clock.runFor(250)}
 await page.waitForTimeout(300);
 assert.equal(await has('Poll visible'),false);
 await page.waitForTimeout(700);await poll();
 assert.equal(await has('Poll visible'),true);
 // Changed data still renders.
 await page.evaluate(async id=>{const e=await api('events/'+id);return api('events/'+id,'PATCH',{title:'Poll renamed',revision:e.revision})},id);await poll();
 assert.equal(await has('Poll renamed'),true);
 assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();server.kill();rmSync(directory,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});

// Synthetic, isolated demo server. Never connects to production or external providers.
const {chromium}=require('playwright');
const {spawn,spawnSync}=require('node:child_process');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const assert=require('node:assert/strict');

exports.withDemo=async function(run){
 const directory=mkdtempSync(join(tmpdir(),'calendar-regression-'));
 const env={...process.env,DEMO_MODE:'true',OPENAI_API_KEY:'',BOT_TOKEN:'',AUTO_SETUP_BOT:'false',DATABASE_PATH:join(directory,'db.sqlite3'),ARCHIVE_KEY_FILE:join(directory,'key.pem'),ARCHIVE_PUBLIC_KEYS:join(directory,'keys.json'),PORT:'0'};
 let server,browser;
 try{
  const seed=spawnSync('python',['-m','scripts.demo_seed'],{env});assert.equal(seed.status,0,seed.stderr?.toString());
  server=spawn('python',['-m','app'],{env,stdio:['ignore','pipe','pipe']});
  const url=await new Promise((resolve,reject)=>{
   let log='';const timeout=setTimeout(()=>reject(Error('demo startup timeout: '+log)),20000);
   server.stderr.on('data',data=>{log+=String(data);const match=log.match(/Uvicorn running on (http:\/\/[^\s]+)/);if(match){clearTimeout(timeout);resolve(match[1].replace('0.0.0.0','127.0.0.1'))}});
   server.once('exit',code=>{clearTimeout(timeout);reject(Error('demo exit '+code+': '+log))});
  });
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  await run({browser,url});
 }finally{
  await browser?.close();
  if(server&&server.exitCode===null){const exited=new Promise(resolve=>server.once('exit',resolve));server.kill();await exited;}
  rmSync(directory,{recursive:true,force:true});
 }
};

exports.openPage=async function(browser,url,options={}){
 const context=await browser.newContext({viewport:{width:402,height:874},isMobile:true,hasTouch:true,timezoneId:'Europe/Warsaw',...options});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://telegram.org/**',route=>route.abort());
 await page.goto(url);await page.waitForSelector('.fab');
 return {page,context,errors};
};

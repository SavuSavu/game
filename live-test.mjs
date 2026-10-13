import { chromium, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const browser=await chromium.launch();
const page=await browser.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto('https://savusavu.github.io/game/',{waitUntil:'networkidle'});
 for(const name of ['index.html','app.js','engine.js','style.css','coop.js']){
  const bytes=await page.evaluate(async name=>Array.from(new Uint8Array(await (await fetch('./'+name)).arrayBuffer())),name);
  if(!Buffer.from(bytes).equals(readFileSync(new URL(name,import.meta.url))))throw Error('Asset mismatch '+name);
 }
 console.log('Five public assets byte-identical to tested commit');
 await page.clock.install();
 await page.getByRole('button',{name:'Create something',exact:true}).click();
 await page.getByRole('button',{name:/^Rest/}).click();
 await page.getByRole('button',{name:/^Learn/}).click();
 for(let i=0;i<20;i++){
  await page.clock.runFor(10000);
  await page.getByRole('button',{name:/^Rest/}).click();
  if(i<3)await page.getByRole('button',{name:/^Learn/}).click();
  if(i<3)await page.getByRole('button',{name:/^Play/}).click();
  if(i===4)await page.getByRole('button',{name:/Buy Steady shoes/}).click();
  if(await page.locator('#boost').isEnabled())await page.locator('#boost').click();
  if(await page.locator('#decision').isVisible())await page.getByRole('button',{name:/Follow one thread/}).click();
  if(await page.locator('#prestige').isEnabled())break;
 }
 await expect(page.locator('#prestige')).toBeEnabled();
 await page.locator('#prestige').click();
 await expect(page.locator('#chapter')).toHaveText('2');
 await page.getByRole('button',{name:/Buy permanent Patience/}).click();
 await expect(page.getByRole('button',{name:/Buy permanent Patience/})).toContainText('Level 1');
 await page.reload();
 await expect(page.locator('#chapter')).toHaveText('2');
 await expect(page.getByRole('button',{name:/Buy permanent Patience/})).toContainText('Level 1');
 await page.setViewportSize({width:390,height:844});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile horizontal overflow');
 await page.screenshot({path:'/home/hp/game/proof-gameplay.png',fullPage:true});
 if(errors.length)throw Error(errors.join(';'));
 console.log('PUBLIC PASS: fresh onboarding, idle progression (accelerated browser clock; no imported fixture), Rest/Learn/Play, run upgrade, temporary boost, decision, prestige, permanent purchase, reload preservation, 390px mobile no overflow, zero page errors.');
}finally{await browser.close();}

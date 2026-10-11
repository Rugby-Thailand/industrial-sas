const {chromium}=require('@playwright/test');const fs=require('node:fs');const path=require('node:path');
(async()=>{const b=await chromium.launch({headless:true});const p=await b.newPage({reducedMotion:'reduce'});p.setDefaultTimeout(8000);p.on('dialog',d=>d.accept());const out=path.join(__dirname,'final');fs.mkdirSync(out,{recursive:true});
for(const width of [1440,390]){await p.setViewportSize({width,height:width===390?844:960});const suffix=width===390?'mobile':'desktop';
const go=async route=>{await p.goto('http://127.0.0.1:3187/preview/?capture='+Date.now()+'#'+route);await p.locator('main').waitFor();await p.evaluate(()=>document.fonts.ready);};
const capture=async name=>{await p.waitForTimeout(150);await p.evaluate(()=>{document.activeElement.blur();window.scrollTo(0,0);});await p.waitForTimeout(100);if(await p.evaluate(()=>scrollY)!==0)throw new Error('Capture must start at document top');await p.screenshot({path:path.join(out,name+'-'+suffix+'.png'),fullPage:true,animations:'disabled'});};
await go('leave-new');await p.fill('#leave-reason','เดินทางกับครอบครัว');await capture('leave-form');
await go('attendance');await capture('attendance');
await go('holidays');await capture('holidays');
await go('announcements');await capture('announcements');
await go('customize');await capture('customize');
await go('payslip/p9');await p.locator('[data-action=reveal-pay]').click();await capture('verification');await p.locator('[data-action=verify-pay]').click();await capture('payslip-revealed');
await go('import');await p.selectOption('#role','hr');await p.locator('[data-action=load-import]').click();await capture('import-validation');
}
await b.close();console.log('Captured 16 additional final state screenshots');})().catch(e=>{console.error(e);process.exit(1);});

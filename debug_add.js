const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('index.html', 'utf-8');
const dom = new JSDOM(html, {
  url: 'http://localhost/',
  pretendToBeVisual: true,
  runScripts: 'outside-only'
});
const { window } = dom;
window.crypto = require('crypto').webcrypto;
const context = dom.getInternalVMContext();
const script = new vm.Script(fs.readFileSync('app.js','utf-8'), { filename: 'app.js' });
script.runInContext(context);
setTimeout(() => {
  const addBtn = window.document.getElementById('addTaskBtn');
  console.log('button?', !!addBtn);
  if (addBtn) {
    addBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const modal = window.document.querySelector('.modal');
    console.log('modal after click?', !!modal);
  }
}, 50);

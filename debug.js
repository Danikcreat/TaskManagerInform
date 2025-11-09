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
  const select = window.document.querySelector('[data-select="status"]');
  if (!select) {
    console.log('no select');
    return;
  }
  const trigger = select.querySelector('.custom-select__trigger');
  trigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  console.log('after click open?', select.classList.contains('is-open'));
  console.log('document handlers bound?', window.document.querySelectorAll('.custom-select').length);
}, 100);

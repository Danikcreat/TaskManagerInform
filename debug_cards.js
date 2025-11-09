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
  const cards = [...window.document.querySelectorAll('.task-card')].map((node) => node.textContent.trim());
  console.log('cards count', cards.length);
  console.log(cards[0]);
}, 50);

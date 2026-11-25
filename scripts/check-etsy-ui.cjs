// Local browser smoke check. Usage: node scripts/check-etsy-ui.cjs PLAYWRIGHT_MODULE CATALOG_JSON
const { chromium } = require(process.argv[2]);
const fs = require('node:fs');
const assert = require('node:assert/strict');
const catalog = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
(async () => {
  const harness = 'frontend/etsy-preview-check.html';
  assert.equal(fs.existsSync(harness), false, 'Temporary preview file already exists');
  fs.writeFileSync(harness, `<!doctype html><html><head><title>Etsy workspace review</title></head><body style="margin:0;background:#f7f9f5;font-family:Arial,sans-serif"><div id="root"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import EtsyListings from '/src/pages/EtsyListings.jsx';createRoot(document.getElementById('root')).render(React.createElement(EtsyListings));</script></body></html>`);
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1050}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let admin = true;
    let row = {id: 1, title: 'Handmade wooden keepsake box', owner_id: 2, status: 'Draft', revision: 1,
      data: {createDraftListing: {title: 'Handmade wooden keepsake box', description: 'A handmade wooden box with a brass clasp.', quantity: 5, price: 30, who_made: 'i_did', when_made: 'made_to_order', type: 'physical', taxonomy_id: 1}},
      assets: [], history: [{at: '2026-11-25T10:00:00', actor: 'Listing preparer', action: 'Created draft'}], review_note: '', issues: []};
    let saved;
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.includes('/service-takers/portal/etsy')) {
        if (url.pathname.endsWith('/workspace')) return route.fulfill({json: {is_admin: admin, catalog, connection: {connected: false, message: 'Draft preparation and review are available.'}, drafts: [row]}});
        if (request.method() === 'PUT') {
          saved = request.postDataJSON();
          row = {...row, data: saved.data, revision: row.revision + 1, title: saved.data.createDraftListing.title};
          return route.fulfill({json: row});
        }
        if (url.pathname.endsWith('/transition')) {
          const {action} = request.postDataJSON();
          row = {...row, status: action === 'submit' ? 'In review' : 'Approved', revision: row.revision + 1};
          return route.fulfill({json: row});
        }
      }
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
        errors.push(`Unexpected external request: ${url.origin}`);
        return route.abort();
      }
      return route.continue();
    });
    await page.goto('http://127.0.0.1:5188/etsy-preview-check.html');
    await page.getByRole('button', {name: /Handmade wooden keepsake box/}).click();
    await page.getByLabel('Title', {exact: false}).fill('Handmade wooden keepsake box — revised');
    await page.getByRole('button', {name: 'Save draft', exact: true}).click();
    await page.getByText('Draft saved to ERP.', {exact: true}).waitFor();
    assert.equal(saved.data.createDraftListing.title, 'Handmade wooden keepsake box — revised');
    const sections = ['Photos & files', 'Price & variations', 'Category attributes', 'Shipping & returns', 'Personalization', 'Safety & guarantees', 'Translations', 'Review & history'];
    for (const name of sections) {
      await page.getByRole('button', {name, exact: true}).click();
      await page.getByRole('heading', {name, exact: true}).waitFor();
    }
    assert.equal(await page.getByRole('button', {name: /Publish to Etsy/}).isDisabled(), true);
    await page.getByRole('button', {name: 'Product details', exact: true}).click();
    fs.mkdirSync('docs/etsy-workspace', {recursive: true});
    await page.screenshot({path: 'docs/etsy-workspace/desktop.png', fullPage: true});
    await page.setViewportSize({width: 390, height: 844});
    await page.screenshot({path: 'docs/etsy-workspace/mobile.png', fullPage: true});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    admin = false;
    await page.reload();
    await page.getByRole('button', {name: /Handmade wooden keepsake box/}).click();
    await page.getByRole('button', {name: 'Review & history', exact: true}).click();
    assert.equal(await page.getByRole('button', {name: /Publish to Etsy|Approve draft/}).count(), 0);
    await page.getByRole('button', {name: 'Submit for review', exact: true}).click();
    await page.getByText('Listing status updated.', {exact: true}).waitFor();
    assert.equal(row.status, 'In review');
    assert.deepEqual(errors, []);
    console.log('PASS: field editing, save, all sections, admin publish disabled, friend submit only, mobile layout, no external browser requests.');
  } finally { await browser.close(); fs.unlinkSync(harness); }
})().catch(e => {console.error(e); process.exitCode = 1;});

// Exercise the real Electron app with an isolated profile; never touch saved user maps.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'civitas-smoke-'));
  const executablePath = process.argv[2];
  const env = { ...process.env, CIVITAS_TEST_HIDE_WINDOW: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({
      ...(executablePath ? { executablePath: path.resolve(executablePath) } : {}),
      args: [...(executablePath ? [] : ['.']), `--user-data-dir=${profile}`],
      env,
      timeout: 60000,
    });
    const errors = [];
    app.context().setDefaultTimeout(30000);
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForLoadState('domcontentloaded');
    assert.equal(new URL(page.url()).origin, 'null'); // custom scheme
    assert.ok(page.url().startsWith('civitas://app/'));
    await page.locator('#home-create-btn').waitFor();
    assert.equal(await page.evaluate(() => typeof polygonClipping.union), 'function');
    const roles = await app.evaluate(({ Menu }) => {
      const collect = menu => menu.items.flatMap(item => [item.role, ...(item.submenu ? collect(item.submenu) : [])]);
      return collect(Menu.getApplicationMenu());
    });
    for (const role of ['copy', 'paste', 'selectall', 'close', 'quit']) {
      assert.ok(roles.includes(role), `Missing native menu role: ${role}`);
    }
    for (const geography of ['precinct', 'blockgroup']) {
      console.log(`Testing ${geography} map…`);
      await page.selectOption('#home-geo-select', geography);
      await page.click('#home-create-btn');
      await page.locator('#race-list button').first().waitFor({ state: 'attached', timeout: 90000 });
      await page.locator('#loading').waitFor({ state: 'hidden', timeout: 90000 });
      assert.ok(await page.locator('#race-list button').count() > 0);
      await page.fill('#map-name-input', `Mac smoke ${geography}`);
      await page.locator('#map-name-input').press('Meta+A');
      assert.equal(await page.locator('#map-name-input').evaluate(el => el.selectionEnd - el.selectionStart), `Mac smoke ${geography}`.length);
      await page.click('#nav-save-map');
      await page.click('#nav-home');
      await page.locator('#home-screen').waitFor();
      assert.ok((await page.locator('#home-maps-tbody').innerText()).includes(`Mac smoke ${geography}`));
    }
    await fs.mkdir('dist', { recursive: true });
    await page.screenshot({ path: 'dist/mac-smoke-test.png' });
    console.log('Saved both maps; testing window close and Dock activation…');
    // Closing the window leaves the Mac app alive; Dock activation recreates it.
    const closed = page.waitForEvent('close', { timeout: 10000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0);
    const reopened = app.waitForEvent('window', { timeout: 10000 });
    await app.evaluate(({ app }) => app.emit('activate'));
    const newPage = await reopened;
    await newPage.locator('#home-create-btn').waitFor();
    const saved = await newPage.locator('#home-maps-tbody').innerText();
    assert.ok(saved.includes('Mac smoke precinct') && saved.includes('Mac smoke blockgroup'));
    assert.deepEqual(errors, []);
    console.log('PASS: native menus, Cmd-A, both map geographies, save/reopen, window close and Dock activation.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (app) {
      // Discard only this temporary profile's windows, including unsaved test maps on failure.
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy()));
      await app.close();
    }
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

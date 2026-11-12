// Offline regression tests. Runtime remains dependency-free JXA + built-in macOS tools.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const vm = require('node:vm');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tahoe-recovery-'));
const repo = path.resolve(__dirname, '..');
let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log('PASS ' + name); };
try {
  const p = {videos: path.join(root, "Home with spaces & quote's", 'videos')};
  fs.mkdirSync(p.videos, {recursive: true});
  const stub = path.join(root, 'fake-curl');
  fs.writeFileSync(stub, [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "const out = process.argv[process.argv.indexOf('--output') + 1];",
    "if (process.env.TAHOE_TEST_DOWNLOAD_MODE === 'fail') { fs.writeFileSync(out, 'partial'); process.exit(22); }",
    "const fd = fs.openSync(out, 'w'); fs.ftruncateSync(fd, 10485760);",
    "fs.writeSync(fd, process.env.TAHOE_TEST_DOWNLOAD_MODE === 'corrupt' ? 'xxxx' : 'ftyp', 4); fs.closeSync(fd);",
  ].join('\n'));
  fs.chmodSync(stub, 0o700);
  let shellCalls = 0;
  let disabled = false;
  const context = {
    ObjC: {import() {}},
    $: {NSProcessInfo: {processInfo: {processIdentifier: 12345}}},
    Application: {currentApplication: () => ({doShellScript: (cmd) => {
      shellCalls += 1;
      const instrumented = cmd.replace('/usr/bin/curl', stub);
      return cp.execFileSync('/bin/sh', ['-c', instrumented], {encoding:'utf8', stdio:['ignore','pipe','pipe']});
    }})},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(repo, 'tahoe-motion-wallpaper.js'), 'utf8'), context);
  context.environmentValue = (name) => name === 'TAHOE_MOTION_NO_DOWNLOAD' && disabled ? '1' : null;
  context.ensureDirectory = (dir) => fs.mkdirSync(dir, {recursive: true});
  const newAsset = () => ({id:'CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC',label:'Tahoe Evening',url:'https://sylvan.apple.com/test.mov',downloaded:false});
  check('already-present asset requires no shell or download', () => {
    const asset = {...newAsset(), downloaded:true};
    assert.equal(context.ensureDesiredAssetDownloaded(asset,p,false),asset); assert.equal(shellCalls,0);
  });
  check('dry-run does not download missing asset', () => {
    assert.throws(()=>context.ensureDesiredAssetDownloaded(newAsset(),p,true), /not downloaded/); assert.equal(shellCalls,0);
  });
  check('explicit download opt-out is respected', () => {
    disabled=true; assert.throws(()=>context.ensureDesiredAssetDownloaded(newAsset(),p,false),/not downloaded/); disabled=false; assert.equal(shellCalls,0);
  });
  check('invalid UUID and non-Apple URL rejected before shell', () => {
    assert.throws(()=>context.ensureDesiredAssetDownloaded({...newAsset(),id:'../escape'},p,false),/Invalid Apple asset ID/);
    assert.throws(()=>context.ensureDesiredAssetDownloaded({...newAsset(),url:'https://sylvan.apple.com.evil.example/a'},p,false),/non-Apple/);
    assert.equal(shellCalls,0);
  });
  check('repair handles spaces/apostrophes, validates QuickTime, atomically installs mode 0600', () => {
    const asset=context.ensureDesiredAssetDownloaded(newAsset(),p,false);
    assert.equal(asset.downloaded,true); assert.equal(fs.statSync(asset.path).size,10485760);
    assert.equal(fs.statSync(asset.path).mode & 0o777,0o600);
    assert(!fs.readdirSync(p.videos).some(x=>x.startsWith('.')));
    fs.unlinkSync(asset.path);
  });
  for (const mode of ['fail','corrupt']) check(mode + ' download preserves prior files and cleans temporary output', () => {
    const prior=path.join(p.videos,'unrelated.mov');fs.writeFileSync(prior,'preserve');
    process.env.TAHOE_TEST_DOWNLOAD_MODE=mode;
    assert.throws(()=>context.ensureDesiredAssetDownloaded(newAsset(),p,false));
    assert.equal(fs.readFileSync(prior,'utf8'),'preserve');
    assert(!fs.readdirSync(p.videos).some(x=>x.startsWith('.')));
    assert(!fs.existsSync(path.join(p.videos,newAsset().id+'.mov')));
    delete process.env.TAHOE_TEST_DOWNLOAD_MODE;
  });
  check('download command has HTTPS redirect, size, time and disk-space bounds', () => {
    const script=context.assetDownloadScript(newAsset(),p,'/tmp/output','/tmp/dest');
    for(const flag of ['--proto-redir', '--max-time 240','--max-filesize 629145600','--connect-timeout 15','614400']) assert(script.includes(flag));
  });
  check('missing inactive variants do not block native JXA dry-run and preference store is unchanged', () => {
    const home=path.join(root,'fixture-home');const wp=path.join(home,'Library/Application Support/com.apple.wallpaper');
    fs.mkdirSync(path.join(wp,'aerials/manifest'),{recursive:true});fs.mkdirSync(path.join(wp,'aerials/videos'),{recursive:true});fs.mkdirSync(path.join(wp,'Store'),{recursive:true});
    fs.copyFileSync(path.join(repo,'tests/fixtures/entries.json'),path.join(wp,'aerials/manifest/entries.json'));
    const store=path.join(wp,'Store/Index.plist');fs.copyFileSync(path.join(repo,'tests/fixtures/Index.plist'),store);
    fs.writeFileSync(path.join(wp,'aerials/videos/AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA.mov'),'present');
    const before=fs.readFileSync(store);
    const env={...process.env,TAHOE_MOTION_HOME:home,TAHOE_MOTION_NO_DOWNLOAD:'1',TAHOE_MOTION_NO_RESTART:'1'};
    const run=(period)=>cp.spawnSync('/usr/bin/osascript',['-l','JavaScript',path.join(repo,'tahoe-motion-wallpaper.js'),'--dry-run','--period',period],{env,encoding:'utf8',timeout:20000});
    const ok=run('morning');assert.equal(ok.status,0,ok.stderr);assert.equal(JSON.parse(ok.stdout).period,'morning');
    const missing=run('evening');assert.notEqual(missing.status,0);assert.match(missing.stderr,/not downloaded/);
    assert.deepEqual(fs.readFileSync(store),before);
  });
  console.log('Recovery checks passed: '+checks);
} finally { fs.rmSync(root,{recursive:true,force:true}); }

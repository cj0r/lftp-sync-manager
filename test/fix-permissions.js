// Checks fixOwnershipAndPermissions() from server.js against the find/chown/chmod
// the image actually ships (BusyBox on Alpine). Run as root, inside the image:
//   docker run --rm -v "$PWD/test:/test" --entrypoint node <image> /test/fix-permissions.js
// It must leave the same owners and modes as chown -R / chmod -R ug+rwX,o+rX did,
// and a second run must not touch anything (no ctime change).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const serverPath = process.env.SERVER_JS || '/app/server.js';
const src = fs.readFileSync(serverPath, 'utf8');
const start = src.indexOf('function runFixStep(');
const end = src.indexOf('function filterLogText(');
if (start < 0 || end < 0) throw new Error(`fix functions not found in ${serverPath}`);
const fixOwnershipAndPermissions = new Function('spawn',
  `${src.slice(start, end)}; return fixOwnershipAndPermissions;`)(spawn);

const fix = (dir) => new Promise((resolve) =>
  fixOwnershipAndPermissions(dir, '99', '100', resolve));
const sh = (...args) => execFileSync(args[0], args.slice(1));
const stat = (p) => fs.lstatSync(p);
const mode = (p) => (stat(p).mode & 0o777).toString(8);
let failed = 0;
const expect = (what, got, want) => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${got}${ok ? '' : ` (want ${want})`}`);
};

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'perm-'));
  const outside = path.join(root, 'outside');
  const d = path.join(root, 'tree');
  fs.writeFileSync(outside, '');
  fs.mkdirSync(path.join(d, 'sub', 'deep'), { recursive: true });
  for (const f of ['a', 'x', 'y', 'sub/b', 'sub/deep/c']) fs.writeFileSync(path.join(d, f), '');
  fs.chmodSync(path.join(d, 'a'), 0o600);
  fs.chmodSync(path.join(d, 'x'), 0o744);
  fs.chmodSync(path.join(d, 'y'), 0o764);
  fs.chmodSync(path.join(d, 'sub'), 0o700);
  fs.symlinkSync(outside, path.join(d, 'link'));
  sh('chown', '-R', '-h', '0:0', d);
  sh('chown', '0:0', outside);
  fs.chmodSync(outside, 0o600);

  expect('first run error', String(await fix(d)), 'null');
  for (const p of ['', 'a', 'x', 'y', 'link', 'sub', 'sub/b', 'sub/deep', 'sub/deep/c']) {
    const s = stat(path.join(d, p));
    expect(`owner ${p || '.'}`, `${s.uid}:${s.gid}`, '99:100');
  }
  expect('mode .', mode(d), '775');
  expect('mode sub', mode(path.join(d, 'sub')), '775');
  expect('mode a (was 600)', mode(path.join(d, 'a')), '664');
  expect('mode x (was 744)', mode(path.join(d, 'x')), '775');
  expect('mode y (was 764)', mode(path.join(d, 'y')), '775');
  expect('symlink target owner', `${stat(outside).uid}:${stat(outside).gid}`, '0:0');
  expect('symlink target mode', mode(outside), '600');

  const ctimes = () => sh('find', d, '-exec', 'stat', '-c', '%n %z', '{}', '+').toString();
  const before = ctimes();
  await new Promise((r) => setTimeout(r, 1100));
  expect('second run error', String(await fix(d)), 'null');
  expect('second run left ctime alone', ctimes() === before, true);

  const missing = await fix(path.join(root, 'missing'));
  expect('missing dir reports an error', missing instanceof Error, true);

  fs.rmSync(root, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})();

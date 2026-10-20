#!/usr/bin/env node
'use strict';

// Installs or removes the progress-status status line in the user's Claude Code settings.
//   node setup.js install    copy the script to ~/.claude/progress-status and point statusLine at it
//   node setup.js uninstall  restore the previous statusLine (or remove it)
//   node setup.js status     show what is configured now
//   node setup.js auto       what the plugin runs on session start: install unless turned off or another statusLine is set
//   node setup.js demo [on|off]  cycle the status line through sample values (toggles with no arg)

const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const INSTALL_DIR = path.join(CLAUDE_DIR, 'progress-status');
const BACKUP = path.join(INSTALL_DIR, 'previous-statusline.json');
const OPT_OUT = path.join(INSTALL_DIR, 'turned-off');
const MARKER = 'progress-status';

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`Could not parse ${SETTINGS}: ${err.message}. Fix the file and try again.`);
  }
}

function writeSettings(settings) {
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function isOurs(statusLine) {
  return !!(statusLine && typeof statusLine.command === 'string' && statusLine.command.includes(MARKER));
}

// Copies this plugin version's status line script to the fixed install folder.
function copyScripts() {
  const scripts = path.join(PLUGIN_ROOT, 'scripts');
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  fs.copyFileSync(path.join(scripts, 'statusline.js'), path.join(INSTALL_DIR, 'statusline.js'));
  copyDir(path.join(scripts, 'lib'), path.join(INSTALL_DIR, 'lib'));

  const configPath = path.join(INSTALL_DIR, 'config.json');
  if (!fs.existsSync(configPath)) {
    fs.copyFileSync(path.join(PLUGIN_ROOT, 'config.example.json'), configPath);
  }
  return configPath;
}

function install() {
  const configPath = copyScripts();
  if (fs.existsSync(OPT_OUT)) fs.unlinkSync(OPT_OUT);

  const settings = readSettings();
  if (settings.statusLine && !isOurs(settings.statusLine)) {
    fs.writeFileSync(BACKUP, JSON.stringify(settings.statusLine, null, 2) + '\n');
    console.log(`Saved your previous statusLine to ${BACKUP}`);
  }

  const command = `node "${toPosix(path.join(INSTALL_DIR, 'statusline.js'))}"`;
  settings.statusLine = { type: 'command', command, padding: 0 };
  writeSettings(settings);

  console.log(`Installed. statusLine -> ${command}`);
  console.log(`Config: ${configPath}`);
  console.log('The status line updates on the next message. Restart Claude Code if it does not appear.');
}

function uninstall() {
  const settings = readSettings();
  if (!isOurs(settings.statusLine)) {
    console.log('progress-status is not the active statusLine; settings left unchanged.');
    return;
  }
  if (fs.existsSync(BACKUP)) {
    settings.statusLine = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
    fs.unlinkSync(BACKUP);
    console.log('Restored your previous statusLine.');
  } else {
    delete settings.statusLine;
    console.log('Removed the statusLine setting.');
  }
  writeSettings(settings);
  // Remember the choice, so automatic setup on session start leaves it off.
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  fs.writeFileSync(OPT_OUT, 'Turned off with /progress-status:remove. /progress-status:setup turns it back on.\n');
  console.log(`Script files are still in ${INSTALL_DIR} (your config.json is kept). Delete that folder if you no longer need it.`);
}

// Run by the plugin on every session start. Prints one word first: installed,
// refreshed, opted-out or other (another status line is set and is left alone).
function auto() {
  if (fs.existsSync(OPT_OUT)) return console.log('opted-out');
  const settings = readSettings();
  if (isOurs(settings.statusLine)) {
    copyScripts();
    return console.log('refreshed');
  }
  if (settings.statusLine) return console.log('other');
  install();
  console.log('installed');
}

function demo(mode) {
  if (!isOurs(readSettings().statusLine)) install();
  const configPath = path.join(INSTALL_DIR, 'config.json');
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    // start from an empty config
  }
  const on = mode === 'on' || (mode !== 'off' && !cfg.demo);
  cfg.demo = on;
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
  console.log(
    on
      ? 'Demo mode ON. Each new message steps the status line through green, yellow and red sample values. Run demo off to go back to real data.'
      : 'Demo mode OFF. The status line shows real task and token data again.'
  );
}

function status() {
  const settings = readSettings();
  if (isOurs(settings.statusLine)) console.log(`Active: ${settings.statusLine.command}`);
  else if (settings.statusLine) console.log(`Another statusLine is active: ${JSON.stringify(settings.statusLine)}`);
  else console.log('No statusLine configured.');
}

const cmd = process.argv[2] || 'install';
try {
  if (cmd === 'install') install();
  else if (cmd === 'uninstall' || cmd === 'remove') uninstall();
  else if (cmd === 'status') status();
  else if (cmd === 'demo') demo(process.argv[3]);
  else if (cmd === 'auto') auto();
  else {
    console.error(`Unknown command "${cmd}". Use install | uninstall | status | demo [on|off] | auto.`);
    process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

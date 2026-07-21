#!/usr/bin/env node
import { main } from './agent.js';
import { CONFIG_PATH, writeTemplate } from './config.js';

const HELP = `claude-split-agent — attribute Claude Code usage to this machine

Usage:
  claude-split-agent          run the agent (watches Claude Code transcripts)
  claude-split-agent init     create a config template at ~/.claude-split/config.json
  claude-split-agent --help   show this help

Config: ${CONFIG_PATH} (chmod 600 — your Claude cookie never leaves this machine)
Docs:   https://github.com/Surfing-Ninja/Claude-Split (agent section)
`;

const command = process.argv[2];

if (command === '--help' || command === '-h' || command === 'help') {
  console.log(HELP);
} else if (command === 'init') {
  const path = writeTemplate();
  console.log(`Config template ready at ${path}`);
  console.log('Fill in the four PASTE fields (see README for cookie instructions), then run:');
  console.log('  claude-split-agent');
} else if (command === undefined) {
  main().catch((err) => {
    console.error('fatal:', err);
    process.exit(1);
  });
} else {
  console.error(`unknown command: ${command}\n`);
  console.log(HELP);
  process.exit(2);
}

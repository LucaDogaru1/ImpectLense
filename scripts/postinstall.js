'use strict';

const fs = require('node:fs');
const path = require('node:path');

function resolveProjectRoot() {
    return process.env.INIT_CWD || process.cwd();
}

function installAgentSkill(io = {}) {
    const log = io.log || (() => {});
    const warn = io.warn || console.warn;

    if (process.env.IMPACTLENS_SKIP_SKILL === '1') {
        return { ok: true, skipped: true, reason: 'IMPACTLENS_SKIP_SKILL=1' };
    }

    const skillSource = path.join(__dirname, '..', 'assets', 'agent-skill', 'SKILL.md');
    if (!fs.existsSync(skillSource)) {
        warn('[impactlens] Agent skill template missing; skip .cursor/skills install.');
        return { ok: false, skipped: true, reason: 'template missing' };
    }

    const projectRoot = resolveProjectRoot();
    const skillDir = path.join(projectRoot, '.cursor', 'skills', 'impactlens');
    const skillDest = path.join(skillDir, 'SKILL.md');

    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(skillDest, fs.readFileSync(skillSource, 'utf8'), 'utf8');
    log(`[impactlens] Cursor agent skill → ${path.relative(projectRoot, skillDest)}`);
    log('[impactlens] Commands: npx impactlens --commands');
    return { ok: true, path: skillDest };
}

if (require.main === module) {
    installAgentSkill();
}

module.exports = { installAgentSkill, resolveProjectRoot };

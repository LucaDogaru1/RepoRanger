'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const testRoot = path.join(projectRoot, 'test');

function findTestFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true })
        .flatMap((entry) => {
            const entryPath = path.join(directory, entry.name);

            if (entry.isDirectory()) {
                return findTestFiles(entryPath);
            }

            return entry.isFile() && entry.name.endsWith('.test.ts')
                ? [entryPath]
                : [];
        })
        .sort();
}

if (!fs.existsSync(testRoot)) {
    console.error(`Test directory not found: ${testRoot}`);
    process.exit(1);
}

const testFiles = findTestFiles(testRoot);

if (testFiles.length === 0) {
    console.error(`No *.test.ts files found in ${testRoot}`);
    process.exit(1);
}

const failures = [];

for (const testFile of testFiles) {
    const relativePath = path.relative(projectRoot, testFile);
    console.log(`\n> ${relativePath}`);

    const result = spawnSync(
        process.execPath,
        ['--require', 'tsx/cjs', testFile],
        { cwd: projectRoot, stdio: 'inherit' },
    );

    if (result.error) {
        console.error(result.error);
        failures.push(relativePath);
        continue;
    }

    if (result.status !== 0) {
        failures.push(relativePath);
    }
}

if (failures.length > 0) {
    console.error(`\n${failures.length} test file(s) failed:`);
    for (const failure of failures) {
        console.error(`- ${failure}`);
    }
    process.exit(1);
}

console.log(`\nAll ${testFiles.length} test files passed.`);

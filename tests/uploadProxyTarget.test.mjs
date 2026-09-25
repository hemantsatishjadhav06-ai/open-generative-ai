// src/lib/uploadProxyTarget.js now only re-exports the upload file-type
// policy (the S3 relay it used to validate is gone).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as legacy from '../src/lib/uploadProxyTarget.js';
import { isBlockedFileType } from '../lib/uploadPolicy.js';

test('re-exports isBlockedFileType from lib/uploadPolicy.js and nothing else', () => {
    assert.equal(legacy.isBlockedFileType, isBlockedFileType);
    assert.deepEqual(Object.keys(legacy), ['isBlockedFileType']);
});

test('isBlockedFileType blocks active content by extension or MIME', () => {
    assert.equal(isBlockedFileType('a.svg'), true);
    assert.equal(isBlockedFileType('x', 'text/html; charset=utf-8'), true);
    assert.equal(isBlockedFileType('A.JS'), true);
    assert.equal(isBlockedFileType('a.png', 'image/svg+xml'), true);
    assert.equal(isBlockedFileType('a.png', 'image/png'), false);
    assert.equal(isBlockedFileType('noext'), false);
    assert.equal(isBlockedFileType('', ''), false);
});

// The S3 upload relay is gone (uploads go to POST /api/v1/upload_file, which
// stores files on fal's CDN). The file-type policy now lives in
// lib/uploadPolicy.js; this re-export keeps existing src/ imports working.
export { isBlockedFileType } from '../../lib/uploadPolicy.js';

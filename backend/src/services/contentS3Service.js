/**
 * contentS3Service.js
 * -------------------
 * Media is NOT archived to S3 any more. Posts, reels, stories and tweets render
 * straight from the platform's own URLs (the frontend already reads `s3_url`
 * first and falls back to the original URL, so records without an S3 copy
 * display as before).
 *
 * The functions keep their signatures so existing callers (monitor, alert
 * investigation, report media) need no changes: every "archive" call returns
 * the media exactly as it was given, and nothing contacts S3.
 */

/** No archiving: nothing is uploaded. */
const archiveMediaItem = async () => null;

/** No archiving: nothing is uploaded. */
const archivePreview = async () => null;

/** Returns the media unchanged — platform URLs are used directly. */
const archiveContentMedia = async (mediaArray) => mediaArray;

/** Returns the media unchanged — platform URLs are used directly. */
const archiveTwitterMedia = async (mediaArray) => mediaArray;

/** Nothing was stored, so there is nothing to delete. */
const deleteContentMediaFromS3 = async () => {};

module.exports = {
  archiveMediaItem,
  archivePreview,
  archiveContentMedia,
  archiveTwitterMedia,
  deleteContentMediaFromS3,
};

/**
 * storyS3Service.js
 * -----------------
 * Instagram story media is NOT archived to S3 any more; stories render from
 * Instagram's own URLs. The functions keep their signatures so the story
 * controller needs no changes: nothing is uploaded, and nothing contacts S3.
 */

/** No archiving: nothing is uploaded. */
const uploadStoryToS3 = async () => null;

/** No archiving: returns null, so callers keep the original URL. */
const archiveStoryMedia = async () => null;

/** Nothing is stored, so there is nothing to delete. */
const deleteStoryFromS3 = async () => {};

/** Nothing is stored. */
const storyExistsInS3 = async () => false;

module.exports = {
  uploadStoryToS3,
  archiveStoryMedia,
  deleteStoryFromS3,
  storyExistsInS3,
};

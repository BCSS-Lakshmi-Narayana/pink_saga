const express = require('express');
const router = express.Router();
const { listVoterProfiles, getVoterProfile, getBoothLevelData, getBoothVoters, getBoothSentiment } = require('../controllers/voterProfileController');
const { protect } = require('../middleware/authMiddleware');
const { loadScope } = require('../middleware/scopeMiddleware');

router.use(protect, loadScope);

router.get('/', listVoterProfiles);
router.get('/:constituency/booths/:part/voters', getBoothVoters);
router.get('/:constituency/booths/:part/sentiment', getBoothSentiment);
router.get('/:constituency/booths', getBoothLevelData);
router.get('/:constituency', getVoterProfile);

module.exports = router;

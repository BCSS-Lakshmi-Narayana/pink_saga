const Keyword = require('../models/Keyword');
const { createAuditLog } = require('../services/auditService');

const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * RBAC: build a Mongo filter that restricts a keyword query to what the
 * caller is allowed to see.
 *   • super admin / party leadership → everything
 *   • scoped MLA/MP                  → keywords for their seat OR party-wide
 *   • everyone else (legacy)         → everything
 */
const buildScopeFilter = (scope) => {
  if (!scope || scope.canSeeAll) return {};
  const seats = scope.constituencies || [];
  if (seats.length === 0) return { _id: { $exists: false } };
  const seatRegex = `^(${seats.map(escapeRx).join('|')})$`;
  return {
    $or: [
      { is_party_wide: true },
      { constituency: { $regex: seatRegex, $options: 'i' } },
    ],
  };
};

// @desc    Get keywords (scope-filtered)
// @route   GET /api/keywords
// @access  Private
const getKeywords = async (req, res) => {
  try {
    const { category, kind, constituency, scope: scopeQuery } = req.query;
    const query = { ...buildScopeFilter(req.scope) };

    if (category) query.category = category;
    if (kind) query.kind = kind;

    // Super admin may narrow by constituency or filter by party-wide only.
    if (req.scope?.canSeeAll) {
      if (constituency) query.constituency = constituency;
      if (scopeQuery === 'party') query.is_party_wide = true;
      if (scopeQuery === 'ac') query.is_party_wide = false;
    }

    const keywords = await Keyword.find(query).limit(2000);
    res.status(200).json(keywords);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create keyword (admins create party-wide; scoped users create AC-only)
// @route   POST /api/keywords
// @access  Private
const createKeyword = async (req, res) => {
  try {
    const payload = { ...(req.body || {}) };
    if (typeof payload.keyword === 'string') payload.keyword = payload.keyword.trim();
    if (!payload.keyword) {
      return res.status(400).json({ message: 'Keyword text is required' });
    }
    if (!payload.category) payload.category = 'other';

    // RBAC: scoped users can never create party-wide entries and must tag
    // the keyword to one of their assigned seats. Super admins may override.
    if (req.scope && !req.scope.canSeeAll) {
      payload.is_party_wide = false;
      if (!payload.constituency || !req.scope.constituencies?.includes(payload.constituency)) {
        // Default to the user's primary constituency.
        payload.constituency = req.scope.constituencies?.[0] || null;
      }
      if (!payload.constituency) {
        return res.status(403).json({ message: 'No constituency in scope for this user' });
      }
    } else {
      // Super admin path: party-wide unless an AC is explicitly supplied.
      payload.is_party_wide = payload.is_party_wide ?? !payload.constituency;
    }
    payload.owner_user_id = req.user?.id || null;

    const keyword = await Keyword.create(payload);

    try {
      await createAuditLog(req.user, 'create', 'keyword', keyword.id, {
        keyword: keyword.keyword,
        constituency: keyword.constituency,
        is_party_wide: keyword.is_party_wide,
      });
    } catch (auditErr) {
      console.warn('[Keyword] Audit log failed (non-fatal):', auditErr.message);
    }

    return res.status(201).json(keyword);
  } catch (error) {
    console.error('[Keyword] Create failed:', error);
    if (error?.code === 11000) {
      return res.status(409).json({ message: `Keyword "${req.body?.keyword}" already exists in this scope` });
    }
    if (error?.name === 'ValidationError') {
      const fields = Object.keys(error.errors || {}).join(', ');
      return res.status(400).json({ message: `Validation failed${fields ? ` on: ${fields}` : ''} — ${error.message}` });
    }
    return res.status(500).json({ message: error.message || 'Internal error creating keyword' });
  }
};

// @desc    Delete keyword
// @route   DELETE /api/keywords/:id
// @access  Private (must own the keyword unless super admin)
const deleteKeyword = async (req, res) => {
  try {
    const keyword = await Keyword.findOne({ id: req.params.id });
    if (!keyword) return res.status(404).json({ message: 'Keyword not found' });

    // RBAC: scoped users can only delete keywords inside their own scope.
    if (req.scope && !req.scope.canSeeAll) {
      const allowedKeys = req.scope.constituencyKeys || new Set();
      const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!keyword.constituency || !allowedKeys.has(norm(keyword.constituency))) {
        return res.status(403).json({ message: 'Not authorized to delete this keyword' });
      }
    }

    await keyword.deleteOne();
    await createAuditLog(req.user, 'delete', 'keyword', req.params.id, {});
    res.status(204).json(null);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const { rescanContent } = require('../services/monitorService');

const triggerRescan = async (req, res) => {
  try {
    const result = await rescanContent();
    await createAuditLog(req.user, 'scan', 'content', 'retroactive', { count: result.scanned });
    res.status(200).json({ message: 'Retroactive scan started', result });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getKeywords,
  createKeyword,
  deleteKeyword,
  triggerRescan,
};

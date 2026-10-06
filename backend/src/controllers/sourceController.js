const Source = require('../models/Source');
const POI = require('../models/POI');
const { createAuditLog } = require('../services/auditService');
const cacheService = require('../services/cacheService');
const mongoose = require('mongoose');
const blugateClient = require('../services/blugateClient');

const SOURCES_CACHE_PREFIX = 'sources:list:v1';
const sendShortCacheHeaders = (res, browserSeconds = 30) => {
  res.set('Cache-Control', `private, max-age=${browserSeconds}`);
};
const invalidateSourcesCache = async () => {
  await cacheService.invalidatePrefix(SOURCES_CACHE_PREFIX);
};

const normalizeFacebookIdentifier = (rawIdentifier) => {
  if (!rawIdentifier) return '';
  const input = String(rawIdentifier).trim();
  if (!input) return '';

  // Reject group monitoring explicitly (not supported by our RapidAPI integration)
  if (/facebook\.com\/(?:groups)\//i.test(input)) {
    return { kind: 'group', identifier: null };
  }

  // If it's a full URL, convert to a canonical Facebook Page/Profile URL.
  if (/^https?:\/\//i.test(input) || /facebook\.com\//i.test(input) || /fb\.me\//i.test(input) || /m\.facebook\.com\//i.test(input)) {
    try {
      const url = new URL(input.startsWith('http') ? input : `https://${input}`);
      const host = url.hostname.replace(/^www\./i, '');
      const pathname = url.pathname || '';

      // profile.php?id=123
      if (/profile\.php/i.test(pathname)) {
        const id = url.searchParams.get('id');
        if (id) return { kind: 'page', identifier: `https://www.facebook.com/profile.php?id=${id}` };
      }

      // /pages/<name>/<id>
      const pagesMatch = pathname.match(/^\/pages\/(?:[^\/]+)\/([^\/]+)/i);
      if (pagesMatch?.[1]) return { kind: 'page', identifier: `https://www.facebook.com/${pagesMatch[1]}` };

      // /<usernameOrId>
      const first = pathname.split('/').filter(Boolean)[0];
      if (!first) return { kind: 'page', identifier: input };

      // Exclude common non-entity routes
      const banned = new Set(['watch', 'reel', 'share', 'photo', 'photos', 'videos', 'events', 'marketplace', 'help', 'login', 'search']);
      if (banned.has(first.toLowerCase())) {
        return { kind: 'page', identifier: input };
      }

      // fb.me short links typically redirect; keep the token as a canonical fb URL
      if (host === 'fb.me') {
        return { kind: 'page', identifier: `https://www.facebook.com/${first}` };
      }

      return { kind: 'page', identifier: `https://www.facebook.com/${first}` };
    } catch (e) {
      // If URL parsing fails, fall through to raw
    }
  }

  // If it's already a slug/id, store as a canonical URL.
  if (/^\d+$/.test(input)) {
    return { kind: 'page', identifier: `https://www.facebook.com/profile.php?id=${input}` };
  }
  return { kind: 'page', identifier: `https://www.facebook.com/${input}` };
};

const normalizeIdentifier = (platform, identifier) => {
  if (!identifier) return '';
  let id = String(identifier).trim();

  switch (platform.toLowerCase()) {
    case 'x':
    case 'twitter':
      // Remove @ and lowercase
      return id.replace(/^@/, '').toLowerCase();
    case 'youtube':
    case 'instagram':
      // Typically case-insensitive handles
      // Normalize Instagram: strip @ and URL path to username
      if (platform.toLowerCase() === 'instagram') {
        // Handle full URL
        if (/^https?:\/\//i.test(id) || /instagram\.com\//i.test(id)) {
          try {
            const url = new URL(id.startsWith('http') ? id : `https://${id}`);
            const parts = url.pathname.split('/').filter(Boolean);
            if (parts.length > 0) id = parts[0];
          } catch (_) {
            // If URL parsing fails, fall through
          }
        }
        id = id.replace(/^@/, '');
      }
      return id.toLowerCase();
    default:
      return id;
  }
};
const rapidApiXService = require('../services/rapidApiXService');

// @desc    Get sources
// @route   GET /api/sources
// @access  Private
const getSources = async (req, res) => {
  try {
    const { platform, is_active, search, suggest, category } = req.query;
    const baseQuery = {};
    if (platform) baseQuery.platform = platform;
    if (is_active !== undefined) baseQuery.is_active = is_active === 'true';
    if (category && category !== 'all') {
      baseQuery.category = category.toLowerCase();
    }

    // RBAC: scoped MLA / MP only sees sources tagged to their seat OR
    // explicitly marked party_wide. Super admin / party leadership: all.
    if (req.scope && !req.scope.canSeeAll) {
      const seats = req.scope.constituencies || [];
      if (seats.length === 0) {
        return res.status(200).json([]);
      }
      const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = `^(${seats.map(escape).join('|')})$`;
      baseQuery.$or = [
        { is_party_wide: true },
        { constituency: { $regex: rx, $options: 'i' } },
      ];
    }

    // Cache the common filter-dropdown call (no search/suggest text), where the
    // result is a stable list. Search/suggest queries have unbounded cardinality
    // and small individual cost — skip caching them.
    const isCacheable = !search && !suggest && !req.query.limit;
    const scopeKey = req.scope?.canSeeAll
      ? 'all'
      : [...(req.scope?.constituencyKeys || [])].sort().join(',');
    const cacheKey = isCacheable
      ? `${SOURCES_CACHE_PREFIX}:${platform || ''}:${is_active || ''}:${category || ''}:${scopeKey}`
      : null;
    if (cacheKey) {
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        sendShortCacheHeaders(res);
        return res.status(200).json(cached);
      }
    }

    let results = [];

    // 1. Core Suggestions (Always priority)
    if (suggest) {
      const rawNames = suggest.split(',').filter(n => n && n.length > 2);
      const uniqueNames = [...new Set(rawNames.map(n => n.toLowerCase().trim()))];
      const words = uniqueNames.flatMap(n => n.split(/[\s._-]+/)).filter(w => w.length > 2);
      const uniqueWords = [...new Set([...uniqueNames, ...words])];

      if (uniqueWords.length > 0) {
        const suggestQuery = {
          ...baseQuery,
          $or: uniqueWords.flatMap(n => [
            { identifier: { $regex: n, $options: 'i' } },
            { identifier: { $regex: n.replace(/\s+/g, ''), $options: 'i' } },
            { display_name: { $regex: n, $options: 'i' } }
          ])
        };
        results = await Source.find(suggestQuery).limit(100);
      }
    }

    // 2. Search / General Population
    const secondaryQuery = { ...baseQuery };
    if (search) {
      secondaryQuery.$or = [
        { identifier: { $regex: search, $options: 'i' } },
        { display_name: { $regex: search, $options: 'i' } }
      ];
    }

    // Determine dynamic limit logic
    let queryLimit = 0; // 0 = no limit
    if (req.query.limit) {
      queryLimit = parseInt(req.query.limit, 10);
    } else if (search || suggest) {
      queryLimit = search ? 400 : 200;
    }

    // Fetch batch of general/search results
    let generalQuery = Source.find(secondaryQuery).sort({ created_at: -1 });
    if (queryLimit > 0) {
      generalQuery = generalQuery.limit(queryLimit);
    }
    const generalResults = await generalQuery;

    // Combine unique results
    const seenIds = new Set(results.map(s => s._id.toString()));
    generalResults.forEach(s => {
      if (!seenIds.has(s._id.toString())) {
        results.push(s);
      }
    });

    // Only slice if an artificial limit was applied for autocomplete scenarios
    if (queryLimit > 0) {
      res.status(200).json(results.slice(0, queryLimit + 100)); // Buffer for suggest combos
    } else {
      if (cacheKey) {
        await cacheService.set(cacheKey, results, 60);
        sendShortCacheHeaders(res);
      }
      res.status(200).json(results);
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create source
// @route   POST /api/sources
// @access  Private
const createSource = async (req, res) => {
  try {
    let { platform, identifier, display_name, category, priority, follower_count, joined_date, poiData, is_active, constituency, is_party_wide } = req.body;
    poiData = poiData || {};

    if (platform === 'facebook') {
      const normalized = normalizeFacebookIdentifier(identifier);
      if (!normalized || !normalized.identifier) {
        if (normalized?.kind === 'group') {
          return res.status(400).json({
            message:
              'Facebook group monitoring is not supported with the current RapidAPI Facebook Scraper integration. Please add Facebook Pages (public) instead.'
          });
        }
        return res.status(400).json({ message: 'Invalid Facebook page identifier/URL' });
      }
      identifier = normalized.identifier;
      if (!display_name || !String(display_name).trim()) {
        display_name = identifier;
      }
    }

    identifier = normalizeIdentifier(platform, identifier);

    const existing = await Source.findOne({ platform, identifier });
    if (existing) {
      return res.status(400).json({ message: 'profile already exist in sources' });
    }

    // RBAC scope: scoped MLA/MP can only create AC-owned sources tagged to one
    // of their seats and may never create party-wide entries. Super admin may
    // tag any AC or leave it party-wide.
    if (req.scope && !req.scope.canSeeAll) {
      is_party_wide = false;
      if (!constituency || !req.scope.constituencies?.includes(constituency)) {
        constituency = req.scope.constituencies?.[0] || null;
      }
      if (!constituency) {
        return res.status(403).json({ message: 'No constituency in scope for this user' });
      }
    } else {
      is_party_wide = is_party_wide ?? !constituency;
      constituency = constituency || null;
    }

    const source = await Source.create({
      platform,
      identifier,
      display_name,
      category: category ? category.toLowerCase() : 'unknown',
      priority: priority || 'medium',
      follower_count: follower_count || '',
      joined_date: joined_date || '',
      is_active: is_active !== false,
      constituency,
      is_party_wide,
      created_by: req.user.id
    });

    // We don't await profile fetching/scanning to keep responsiveness high.
    // This allows immediate linking while data populates in background.
    if (platform === 'x' || platform === 'youtube' || platform === 'facebook' || platform === 'instagram') {
      const runBackgroundTask = async () => {
        try {
          // 1. Fetch profile metadata (if applicable)
          if (platform === 'x') {
            const profile = await rapidApiXService.fetchUserProfile(identifier);
            if (profile) {
              await Source.updateOne(
                { id: source.id },
                {
                  $set: {
                    is_verified: profile.isVerified,
                    profile_image_url: profile.profileImageUrl
                  }
                }
              );
            }
          }

          // 2. Trigger initial scan to populate feed
          const { scanSourceOnce } = require('../services/monitorService');
          await scanSourceOnce(source);
        } catch (error) {
          // console.error(`[Background Task] Error for ${identifier}:`, error.message);
        }
      };

      runBackgroundTask();
    }

    // Auto-create or link POI profile
    const linkOrCreatePOIFromSource = async (src, pData = {}) => {
      try {
        // Search for an existing POI that already has this source handle and platform in socialMedia
        // or a POI whose realName exactly matches the display name (simple heuristics).
        // Since alias/names can overlap, we rely primarily on socialMedia handle matching.
        let poi = await POI.findOne({
          'socialMedia.handle': src.identifier,
          'socialMedia.platform': src.platform
        });

        if (poi) {
          // If POI exists, ensure it has the sourceId linked
          const socialMediaIndex = poi.socialMedia.findIndex(
            (sm) => sm.handle === src.identifier && sm.platform === src.platform
          );
          if (socialMediaIndex !== -1 && !poi.socialMedia[socialMediaIndex].sourceId) {
            poi.socialMedia[socialMediaIndex].sourceId = src.id;
            // Optionally update avatar if missing
            if (!poi.profileImage && src.profile_image_url) {
              poi.profileImage = src.profile_image_url;
            }
            await poi.save();
          }
        } else {
          // Construct social media array
          let smArray = [];
          if (pData.socialMedia && pData.socialMedia.length > 0) {
            smArray = [];
            for (const sm of pData.socialMedia) {
              const isPrimary = sm.handle === src.identifier && sm.platform === src.platform;
              let smSourceId = undefined;
              let smProfileImage = '';
              let smDisplayName = '';

              if (isPrimary) {
                smSourceId = src.id;
                smProfileImage = src.profile_image_url || '';
                smDisplayName = src.display_name;
              } else if (sm.handle && sm.platform) {
                // Determine normalized identifier
                let normId = sm.handle;
                if (sm.platform === 'facebook') {
                  const normalized = normalizeFacebookIdentifier(sm.handle);
                  if (normalized && normalized.identifier && normalized.kind !== 'group') {
                    normId = normalized.identifier;
                  }
                } else {
                  normId = normalizeIdentifier(sm.platform, sm.handle);
                }

                // Auto-create source if it doesn't exist
                if (normId) {
                  let exSource = await Source.findOne({ platform: sm.platform, identifier: normId });
                  if (!exSource) {
                    exSource = await Source.create({
                      platform: sm.platform,
                      identifier: normId,
                      display_name: sm.displayName || sm.handle,
                      category: (sm.category || src.category || 'others').toLowerCase(),
                      priority: sm.priority || src.priority || 'medium',
                      is_active: sm.isActive !== false,
                      created_by: src.created_by
                    });

                    // Kick off background scan
                    if (['x', 'youtube', 'facebook', 'instagram'].includes(sm.platform)) {
                      const bgTask = async () => {
                        try {
                          if (sm.platform === 'x') {
                            const profile = await rapidApiXService.fetchUserProfile(normId);
                            if (profile) {
                              await Source.updateOne(
                                { id: exSource.id },
                                { $set: { is_verified: profile.isVerified, profile_image_url: profile.profileImageUrl } }
                              );
                            }
                          }
                          const { scanSourceOnce } = require('../services/monitorService');
                          await scanSourceOnce(exSource);
                        } catch (e) {
                          // ignore background errors
                        }
                      };
                      bgTask();
                    }
                  }

                  if (exSource) {
                    smSourceId = exSource.id;
                    smDisplayName = exSource.display_name;
                    smProfileImage = exSource.profile_image_url || '';
                  }
                }
              }

              smArray.push({
                platform: sm.platform,
                sourceId: smSourceId,
                handle: sm.handle,
                displayName: smDisplayName || undefined,
                profileImage: smProfileImage,
                followerCount: sm.followerCount || undefined,
                createdDate: sm.createdDate || undefined
              });
            }
          } else {
            smArray = [{
              platform: src.platform,
              sourceId: src.id,
              handle: src.identifier,
              displayName: src.display_name,
              profileImage: src.profile_image_url || '',
              followerCount: src.follower_count || '',
              createdDate: src.joined_date || ''
            }];
          }

          // Create new POI
          const newPoi = new POI({
            name: pData.realName || src.display_name,
            realName: pData.realName || src.display_name,
            aliasNames: pData.aliasNames || [],
            mobileNumbers: pData.mobileNumbers || [],
            emailIds: pData.emailIds || [],
            whatsappNumbers: pData.whatsappNumbers || [],
            currentAddress: pData.currentAddress || '',
            psLimits: pData.psLimits || '',
            districtCommisionerate: pData.districtCommisionerate || '',
            lastUsedIp: pData.lastUsedIp || '',
            softwareHardwareIdentifiers: pData.softwareHardwareIdentifiers || '',
            firNo: pData.firNo || '',
            firDetails: pData.firDetails || [],
            linkedIncidents: pData.linkedIncidents || '',
            briefSummary: pData.briefSummary || '',
            escalatedToIntermediariesCount: pData.escalatedToIntermediariesCount ? Number(pData.escalatedToIntermediariesCount) : 0,
            profileImage: src.profile_image_url || '',
            socialMedia: smArray,
            previouslyDeletedProfiles: pData.previouslyDeletedProfiles || { x: [], facebook: [], instagram: [], youtube: [], whatsapp: [] },
            createdBy: 'system',
            status: 'active'
          });
          await newPoi.save();
        }
      } catch (err) {
        console.error('[POI Link Error] Failed to auto-link/create POI for source:', err.message);
      }
    };

    // Do not await this to keep response fast
    linkOrCreatePOIFromSource(source, poiData);

    await createAuditLog(req.user, 'create', 'source', source.id, { display_name });

    await invalidateSourcesCache();
    res.status(201).json(source);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update source
// @route   PUT /api/sources/:id
// @access  Private
const updateSource = async (req, res) => {
  try {
    let source = await Source.findOne({ id: req.params.id });

    if (!source && mongoose.Types.ObjectId.isValid(req.params.id)) {
      source = await Source.findById(req.params.id);
    }

    if (!source) {
      return res.status(404).json({ message: 'Source not found' });
    }

    // Use the found source's actual ID (UUID) for the update query if possible, or _id
    const query = source.id ? { id: source.id } : { _id: source._id };

    const updateData = { ...req.body };
    if (updateData.category) {
      updateData.category = updateData.category.toLowerCase();
    }

    const updatedSource = await Source.findOneAndUpdate(
      query,
      updateData,
      { new: true }
    );

    // Sync back to POI
    if (updatedSource) {
      try {
        const poiData = req.body.poiData;
        const linkedPois = await POI.find({ "socialMedia.sourceId": updatedSource.id });

        for (const poi of linkedPois) {
          let hasChanges = false;

          // 1. Update POI core fields if poiData is provided
          if (poiData) {
            const fieldsToUpdate = [
              'realName', 'aliasNames', 'mobileNumbers', 'emailIds', 'whatsappNumbers',
              'currentAddress', 'psLimits', 'districtCommisionerate', 'lastUsedIp',
              'softwareHardwareIdentifiers', 'firNo', 'firDetails', 'linkedIncidents',
              'briefSummary', 'previouslyDeletedProfiles', 'profileImage', 'status'
            ];

            fieldsToUpdate.forEach(field => {
              if (poiData[field] !== undefined) {
                poi[field] = poiData[field];
                hasChanges = true;
              }
            });

            if (poiData.realName) {
              poi.name = poiData.realName;
            }
          }

          // 2. Update the specific socialMedia entry for this source
          poi.socialMedia = poi.socialMedia.map(sm => {
            if (sm.sourceId === updatedSource.id) {
              const newCategory = (updatedSource.category || '').toLowerCase();
              const newPriority = updatedSource.priority || 'medium';

              if (sm.category !== newCategory ||
                sm.priority !== newPriority ||
                sm.followerCount !== (updatedSource.follower_count || '') ||
                sm.createdDate !== (updatedSource.joined_date || '') ||
                sm.displayName !== updatedSource.display_name) {
                hasChanges = true;
                return {
                  ...(sm.toObject ? sm.toObject() : sm),
                  category: newCategory,
                  priority: newPriority,
                  followerCount: updatedSource.follower_count || '',
                  createdDate: updatedSource.joined_date || '',
                  displayName: updatedSource.display_name
                };
              }
            }
            return sm;
          });

          if (hasChanges) {
            await poi.save();
          }
        }
      } catch (poiError) {
        console.error('[Sync POI Error] Failed to sync source update to POI:', poiError.message);
      }
    }

    await createAuditLog(req.user, 'update', 'source', source.id || source._id, req.body);
    await invalidateSourcesCache();
    res.status(200).json(updatedSource);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete source
// @route   DELETE /api/sources/:id
// @access  Private
const deleteSource = async (req, res) => {
  try {
    let source = await Source.findOne({ id: req.params.id });

    if (!source && mongoose.Types.ObjectId.isValid(req.params.id)) {
      source = await Source.findById(req.params.id);
    }

    if (!source) {
      return res.status(404).json({ message: 'Source not found' });
    }

    await source.deleteOne();

    // Cleanup: Remove this source from all linked POIs
    try {
      await POI.updateMany(
        { 'socialMedia.sourceId': { $in: [source.id, source._id.toString()] } },
        { $pull: { socialMedia: { sourceId: { $in: [source.id, source._id.toString()] } } } }
      );
    } catch (cleanupError) {
      console.error('[Source Cleanup] Failed to remove source from POIs:', cleanupError.message);
    }

    await createAuditLog(req.user, 'delete', 'source', source.id || source._id, {});

    await invalidateSourcesCache();
    res.status(204).json(null);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Manual check source
// @route   POST /api/sources/:id/check
// @access  Private
const manualCheck = async (req, res) => {
  try {
    let source = await Source.findOne({ id: req.params.id });

    if (!source && mongoose.Types.ObjectId.isValid(req.params.id)) {
      source = await Source.findById(req.params.id);
    }

    if (!source) {
      return res.status(404).json({ message: 'Source not found' });
    }

    // Simulate check logic or call a service
    source.last_checked = new Date();
    await source.save();

    await createAuditLog(req.user, 'manual_check', 'source', req.params.id, {
      display_name: source.display_name,
      status: 'checked'
    });

    res.status(200).json({ message: 'Manual check initiated', source });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Toggle source active status (pause/resume)
// @route   PUT /api/sources/:id/toggle
// @access  Private
const toggleSourceStatus = async (req, res) => {
  try {
    let source = await Source.findOne({ id: req.params.id });

    if (!source && mongoose.Types.ObjectId.isValid(req.params.id)) {
      source = await Source.findById(req.params.id);
    }

    if (!source) {
      return res.status(404).json({ message: 'Source not found' });
    }

    // Toggle is_active status
    source.is_active = !source.is_active;
    await source.save();

    const action = source.is_active ? 'resumed' : 'paused';
    await createAuditLog(req.user, action, 'source', source.id || source._id, {
      display_name: source.display_name,
      is_active: source.is_active
    });

    await invalidateSourcesCache();
    res.status(200).json({
      message: `Monitoring ${action} for ${source.display_name}`,
      source
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Bulk create sources
// @route   POST /api/sources/bulk
// @access  Private
const createSourcesBulk = async (req, res) => {
  try {
    let { platform, identifiers, category, priority } = req.body;

    platform = String(platform || '').toLowerCase();
    if (!platform) return res.status(400).json({ message: 'platform is required' });
    if (!Array.isArray(identifiers) || identifiers.length === 0) {
      return res.status(400).json({ message: 'identifiers must be a non-empty array' });
    }

    const created = [];
    const skipped = [];
    const failed = [];

    for (const raw of identifiers) {
      try {
        let identifier = String(raw || '').trim();
        if (!identifier) {
          failed.push({ identifier: raw, reason: 'Empty identifier' });
          continue;
        }

        let display_name = identifier;

        if (platform === 'facebook') {
          const normalized = normalizeFacebookIdentifier(identifier);
          if (!normalized || !normalized.identifier) {
            if (normalized?.kind === 'group') {
              failed.push({ identifier, reason: 'Facebook group URLs are not supported' });
              continue;
            }
            failed.push({ identifier, reason: 'Invalid Facebook page identifier/URL' });
            continue;
          }
          identifier = normalized.identifier;
          display_name = identifier;
        }

        identifier = normalizeIdentifier(platform, identifier);

        const existing = await Source.findOne({ platform, identifier });
        if (existing) {
          skipped.push({ identifier, reason: 'profile already exist in sources', id: existing.id });
          continue;
        }

        const source = await Source.create({
          platform,
          identifier,
          display_name,
          category: category ? String(category).toLowerCase() : 'unknown',
          priority: priority || 'medium',
          created_by: req.user.id
        });

        // Auto-create or link POI profile
        const linkOrCreatePOIFromSource = async (src) => {
          try {
            let poi = await POI.findOne({
              'socialMedia.handle': src.identifier,
              'socialMedia.platform': src.platform
            });

            if (poi) {
              const socialMediaIndex = poi.socialMedia.findIndex(
                (sm) => sm.handle === src.identifier && sm.platform === src.platform
              );
              if (socialMediaIndex !== -1 && !poi.socialMedia[socialMediaIndex].sourceId) {
                poi.socialMedia[socialMediaIndex].sourceId = src.id;
                if (!poi.profileImage && src.profile_image_url) {
                  poi.profileImage = src.profile_image_url;
                }
                await poi.save();
              }
            } else {
              const newPoi = new POI({
                name: src.display_name,
                realName: src.display_name,
                profileImage: src.profile_image_url || '',
                socialMedia: [{
                  platform: src.platform,
                  sourceId: src.id,
                  handle: src.identifier,
                  displayName: src.display_name,
                  profileImage: src.profile_image_url || '',
                }],
                createdBy: 'system',
                status: 'active'
              });
              await newPoi.save();
            }
          } catch (err) {
            console.error('[POI Link Error] Failed to auto-link/create POI for bulk source:', err.message);
          }
        };

        // Fire and forget
        linkOrCreatePOIFromSource(source);

        created.push({ id: source.id, identifier: source.identifier, display_name: source.display_name });
      } catch (e) {
        failed.push({ identifier: raw, reason: e.message || 'Failed to create' });
      }
    }

    await createAuditLog(req.user, 'bulk_create', 'source', null, {
      platform,
      created: created.length,
      skipped: skipped.length,
      failed: failed.length
    });

    await invalidateSourcesCache();
    res.status(200).json({ created, skipped, failed });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getRetryAfterSeconds = (error) => {
  const header = error?.response?.headers?.['retry-after'];
  const parsedHeader = Number(header);
  if (Number.isFinite(parsedHeader) && parsedHeader > 0) return parsedHeader;
  if (Number.isFinite(error?.retryAfterSeconds) && error.retryAfterSeconds > 0) return error.retryAfterSeconds;

  const fallback = Number(process.env.RAPIDAPI_FACEBOOK_COOLDOWN_SECONDS);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 90;
};

// @desc    Scan a single source now (fetch + ingest + analyze)
// @route   POST /api/sources/:id/scan
// @access  Private
const scanNow = async (req, res) => {
  try {
    const { scanSourceOnce } = require('../services/monitorService');
    let source = await Source.findOne({ id: req.params.id });
    if (!source && mongoose.Types.ObjectId.isValid(req.params.id)) {
      source = await Source.findById(req.params.id);
    }
    if (!source) {
      return res.status(404).json({ message: 'Source not found' });
    }

    // Guard: Instagram requires BluGate credentials.
    if (source.platform === 'instagram' && !blugateClient.hasCredentials()) {
      return res.status(400).json({
        message: 'BluGate credentials are not configured. Please set BLUGATE_API_KEY and BLUGATE_CLIENT_CODE in .env.'
      });
    }

    // For now this endpoint is primarily intended for Facebook sources.
    // We still allow other platforms, but Facebook gets special 429 surfacing.
    const result = await scanSourceOnce(source, { throwOnCooldown: source.platform === 'facebook' });

    await createAuditLog(req.user, 'manual_scan', 'source', source.id || source._id, {
      platform: source.platform,
      identifier: source.identifier,
      scanned: result.scanned
    });

    return res.status(200).json({
      message: `Scan completed for ${source.display_name}`,
      scanned: result.scanned,
      ingested: result.ingested
    });
  } catch (error) {
    const status = error?.response?.status;
    if (status === 429 || error?.code === 'FB_RAPIDAPI_COOLDOWN') {
      return res.status(429).json({
        message: 'Facebook is temporarily rate limited. Please retry later.',
        retryAfterSeconds: getRetryAfterSeconds(error)
      });
    }
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Scan all active sources for a platform
// @route   POST /api/sources/scan-all
// @access  Private
const scanAllSources = async (req, res) => {
  try {
    const { scanSourceOnce } = require('../services/monitorService');
    const { platform } = req.body;
    const query = { is_active: true };
    if (platform) query.platform = platform;

    if (platform === 'instagram' && !blugateClient.hasCredentials()) {
      return res.status(400).json({
        message: 'BluGate credentials are not configured. Please set BLUGATE_API_KEY and BLUGATE_CLIENT_CODE in .env.'
      });
    }

    const sources = await Source.find(query);
    if (sources.length === 0) {
      return res.status(404).json({ message: 'No active sources found to scan' });
    }

    // We run them in sequence or small batches to avoid hitting local rate limits/concurrency issues too hard
    let totalScanned = 0;
    let totalIngested = 0;
    const results = [];

    for (const source of sources) {
      try {
        const result = await scanSourceOnce(source);
        totalScanned += result.scanned || 0;
        totalIngested += result.ingested || 0;
        results.push({ id: source.id, name: source.display_name, status: 'success', scanned: result.scanned });
      } catch (err) {
        results.push({ id: source.id, name: source.display_name, status: 'failed', error: err.message });
      }
    }

    await createAuditLog(req.user, 'bulk_scan', 'source', 'multiple', {
      platform,
      count: sources.length,
      totalScanned,
      totalIngested
    });

    res.status(200).json({
      message: `Bulk scan completed for ${sources.length} sources`,
      totalScanned,
      totalIngested,
      results
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get live Instagram profile info (followers, following, bio, etc.)
// @route   GET /api/sources/:id/instagram-profile
// @access  Private
const getInstagramProfile = async (req, res) => {
  try {
    const source = await Source.findOne({ id: req.params.id });
    if (!source) return res.status(404).json({ message: 'Source not found' });
    if (source.platform !== 'instagram') return res.status(400).json({ message: 'Source is not an Instagram account' });

    const handle = source.identifier;
    const { fetchUserProfile } = require('../services/rapidApiInstagramService');
    const raw = await fetchUserProfile(handle);

    // Extract profile from raw response (same logic as monitorService)
    const pickFirst = (...values) => values.find(v => v !== undefined && v !== null && v !== '');
    const data = raw?.data?.data || raw?.data || raw?.result || raw;
    const user = data?.user || data?.data?.user || data?.user_info?.user || data?.userInfo || data?.profile || data?.result?.user || data?.result?.data?.user || null;

    if (!user) {
      // Return cached data from source if API fails
      return res.json({
        username: source.identifier,
        full_name: source.display_name,
        profile_pic_url: source.profile_image_url || '',
        followers_count: source.statistics?.subscriber_count || 0,
        following_count: 0,
        media_count: source.statistics?.video_count || 0,
        biography: '',
        is_verified: source.is_verified || false,
        external_url: '',
        category: source.category || '',
        is_private: false,
        _cached: true
      });
    }

    const profileData = {
      username: pickFirst(user.username, user.user?.username, handle),
      full_name: pickFirst(user.full_name, user.name, user.fullName, user.user?.full_name, source.display_name),
      profile_pic_url: pickFirst(user.profile_pic_url_hd, user.profile_pic_url, user.profile_pic, user.avatar, source.profile_image_url),
      followers_count: Number(pickFirst(user.edge_followed_by?.count, user.follower_count, user.followers, user.followers_count) || source.statistics?.subscriber_count || 0),
      following_count: Number(pickFirst(user.edge_follow?.count, user.following_count, user.following, user.followees_count) || 0),
      media_count: Number(pickFirst(user.edge_owner_to_timeline_media?.count, user.media_count, user.posts_count, user.post_count) || source.statistics?.video_count || 0),
      biography: pickFirst(user.biography, user.bio, user.about, user.description) || '',
      is_verified: pickFirst(user.is_verified, user.isVerified) || false,
      external_url: pickFirst(user.external_url, user.website, user.url) || '',
      category: pickFirst(user.category_name, user.category, user.account_type) || source.category || '',
      is_private: pickFirst(user.is_private, user.isPrivate) || false,
      bio_links: user.bio_links || [],
      mutual_followers: user.edge_mutual_followed_by?.edges?.map(e => e.node?.username).filter(Boolean) || [],
      mutual_followers_count: user.edge_mutual_followed_by?.count || 0
    };

    // Update source with latest data
    const updates = {};
    if (profileData.profile_pic_url && profileData.profile_pic_url !== source.profile_image_url) {
      updates.profile_image_url = profileData.profile_pic_url;
    }
    if (profileData.full_name && profileData.full_name !== source.display_name) {
      updates.display_name = profileData.full_name;
    }
    if (profileData.is_verified !== undefined) {
      updates.is_verified = profileData.is_verified;
    }
    updates.statistics = {
      ...(source.statistics || {}),
      subscriber_count: profileData.followers_count || source.statistics?.subscriber_count || 0,
      video_count: profileData.media_count || source.statistics?.video_count || 0,
      view_count: source.statistics?.view_count || 0
    };
    if (Object.keys(updates).length > 0) {
      await Source.findOneAndUpdate({ id: source.id }, { $set: updates });
    }

    return res.json(profileData);
  } catch (error) {
    //console.error('[getInstagramProfile] Error:', error.message);
    // Fallback to cached source data
    try {
      const source = await Source.findOne({ id: req.params.id });
      if (source) {
        return res.json({
          username: source.identifier,
          full_name: source.display_name,
          profile_pic_url: source.profile_image_url || '',
          followers_count: source.statistics?.subscriber_count || 0,
          following_count: 0,
          media_count: source.statistics?.video_count || 0,
          biography: '',
          is_verified: source.is_verified || false,
          external_url: '',
          category: source.category || '',
          is_private: false,
          _cached: true
        });
      }
    } catch (_) { /* ignore */ }
    return res.status(500).json({ message: error.message });
  }
};

/**
 * POST /api/sources/resolve-identity  { platform, identifier }
 * Looks up the platform's numeric account id for a handle, so the Add Source
 * form can show it and confirm the account exists. Informational only:
 * saving a source never depends on it.
 *   200 { platformUserId, name, verified }   found
 *   404 { message }                          no such account
 *   200 { platformUserId: '' , note }        platform has no lookup (Facebook)
 */
const resolveIdentity = async (req, res) => {
  try {
    const platform = String(req.body?.platform || '').toLowerCase();
    const identifier = String(req.body?.identifier || '').trim();
    if (!identifier) return res.status(400).json({ message: 'identifier is required' });

    if (platform === 'x') {
      const profile = await rapidApiXService.fetchUserProfile(identifier);
      if (!profile || !profile.id) return res.status(404).json({ message: `No X account found for ${identifier}` });
      return res.json({ platformUserId: String(profile.id), name: profile.name || '', verified: !!profile.isVerified });
    }

    if (platform === 'instagram') {
      const { fetchUserProfile } = require('../services/rapidApiInstagramService');
      const data = await fetchUserProfile(identifier.replace(/^@/, ''));
      const first = Array.isArray(data?.result) ? data.result[0] : data?.result;
      const user = first?.user || data?.data?.user || data?.user || data?.data || data || {};
      const id = user.id || user.pk || user.pk_id || user.user_id;
      if (!id) return res.status(404).json({ message: `No Instagram account found for ${identifier}` });
      return res.json({ platformUserId: String(id), name: user.full_name || '', verified: !!user.is_verified });
    }

    if (platform === 'youtube') {
      if (!blugateClient.hasCredentials()) return res.json({ platformUserId: '', note: 'YouTube lookup unavailable' });
      // Channel id, channel URL, @handle or /user/ URL: resolved without search.list.
      const ch = await require('../services/youtubeChannelService').resolveChannel(identifier);
      if (!ch || !ch.id) return res.status(404).json({ message: `No YouTube channel found for ${identifier}` });
      return res.json({ platformUserId: ch.id, name: ch.title || '' });
    }

    // Facebook pages are monitored by page name; there is no id lookup.
    return res.json({ platformUserId: '', note: 'No automatic lookup for this platform' });
  } catch (error) {
    return res.status(502).json({ message: `Lookup failed: ${error.message}` });
  }
};

module.exports = {
  resolveIdentity,
  getSources,
  createSource,
  updateSource,
  deleteSource,
  manualCheck,
  toggleSourceStatus,
  scanNow,
  scanAllSources,
  createSourcesBulk,
  getInstagramProfile
};

const WORKFLOW_STATUSES = ['received', 'reviewed', 'action_taken', 'closed', 'converted_to_fir'];

const WORKFLOW_TO_LEGACY = {
  received: { classification: 'unclassified', complaintStatus: 'pending' },
  reviewed: { classification: 'complaint', complaintStatus: 'pending' },
  action_taken: { classification: 'complaint', complaintStatus: 'sent' },
  closed: { classification: 'complaint', complaintStatus: 'reviewed' },
  converted_to_fir: { classification: 'complaint', complaintStatus: 'case_booked' }
};

const ALLOWED_TRANSITIONS = {
  received: new Set(['reviewed', 'closed', 'converted_to_fir']),
  reviewed: new Set(['action_taken', 'closed', 'converted_to_fir']),
  action_taken: new Set(['closed', 'converted_to_fir']),
  closed: new Set(['converted_to_fir']),
  converted_to_fir: new Set()
};

const legacyStatusToWorkflow = (legacyStatus) => {
  if (legacyStatus === 'case_booked') return 'converted_to_fir';
  if (legacyStatus === 'reviewed') return 'closed';
  if (legacyStatus === 'sent') return 'closed';
  if (legacyStatus === 'pending') return 'reviewed';
  return 'received';
};

const normalizeWorkflowStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  return WORKFLOW_STATUSES.includes(normalized) ? normalized : null;
};

const inferWorkflowStatusFromLegacy = (grievance) => {
  const explicit = normalizeWorkflowStatus(grievance?.workflow_status);
  if (explicit) return explicit;

  const complaintStatus = grievance?.complaint?.status;
  if (complaintStatus) return legacyStatusToWorkflow(complaintStatus);

  if (grievance?.classification === 'complaint') return 'reviewed';
  return 'received';
};

const isValidTransition = (fromStatus, toStatus) => {
  if (fromStatus === toStatus) return true;
  const allowed = ALLOWED_TRANSITIONS[fromStatus];
  return Boolean(allowed && allowed.has(toStatus));
};

const syncLegacyFieldsFromWorkflow = (grievance, workflowStatus) => {
  const normalized = normalizeWorkflowStatus(workflowStatus);
  if (!normalized) return;

  grievance.workflow_status = normalized;

  if (!grievance.complaint) grievance.complaint = {};

  const legacy = WORKFLOW_TO_LEGACY[normalized];
  grievance.classification = legacy.classification;
  grievance.complaint.status = legacy.complaintStatus;

  if (!grievance.workflow_timestamps) grievance.workflow_timestamps = {};
  const now = new Date();
  const markIfMissing = (key) => {
    if (!grievance.workflow_timestamps[key]) grievance.workflow_timestamps[key] = now;
  };

  markIfMissing('received_at');
  if (normalized === 'reviewed') markIfMissing('reviewed_at');
  if (normalized === 'action_taken') markIfMissing('action_taken_at');
  if (normalized === 'closed') markIfMissing('closed_at');
  if (normalized === 'converted_to_fir') markIfMissing('fir_converted_at');
};

const pushWorkflowHistory = (grievance, fromStatus, toStatus, userId, note, at = new Date()) => {
  if (!grievance.workflow_history) grievance.workflow_history = [];
  grievance.workflow_history.push({
    from: fromStatus || null,
    to: toStatus,
    at,
    by: userId || 'system',
    note: note || undefined
  });
};

const applyWorkflowTransition = (grievance, toStatus, options = {}) => {
  const normalizedTo = normalizeWorkflowStatus(toStatus);
  if (!normalizedTo) {
    const err = new Error('Invalid workflow status');
    err.code = 'INVALID_WORKFLOW_STATUS';
    throw err;
  }

  const fromStatus = inferWorkflowStatusFromLegacy(grievance);
  if (!isValidTransition(fromStatus, normalizedTo)) {
    const err = new Error(`Invalid workflow transition from ${fromStatus} to ${normalizedTo}`);
    err.code = 'INVALID_WORKFLOW_TRANSITION';
    throw err;
  }

  if (fromStatus === normalizedTo) return normalizedTo;

  const at = options.at || new Date();
  syncLegacyFieldsFromWorkflow(grievance, normalizedTo);

  if (normalizedTo === 'converted_to_fir') {
    grievance.fir_converted_at = at;
    grievance.fir_converted_by = options.userId || grievance.fir_converted_by;
    if (options.firNumber) grievance.fir_number = options.firNumber;
    if (!grievance.workflow_timestamps) grievance.workflow_timestamps = {};
    grievance.workflow_timestamps.fir_converted_at = at;
  }

  pushWorkflowHistory(grievance, fromStatus, normalizedTo, options.userId, options.note, at);
  return normalizedTo;
};

const canConvertToFir = (grievance) => inferWorkflowStatusFromLegacy(grievance) !== 'converted_to_fir';

const tabToWorkflowQuery = (tab) => {
  const value = String(tab || 'all').trim().toLowerCase();
  if (value === 'pending') {
    return {
      $or: [
        // Match by G-workflow status PENDING
        { 'grievance_workflow.status': 'PENDING' },
        // Legacy: no G-workflow yet, use old workflow_status
        {
          'grievance_workflow.status': { $exists: false },
          $or: [
            { workflow_status: { $in: ['received', 'reviewed', 'action_taken'] } },
            {
              workflow_status: { $exists: false },
              $or: [
                { classification: { $in: ['unclassified', 'acknowledged'] } },
                { classification: 'complaint', 'complaint.status': 'pending' }
              ]
            }
          ]
        }
      ]
    };
  }
  if (value === 'escalated') {
    return {
      'grievance_workflow.status': 'ESCALATED'
    };
  }
  if (value === 'closed') {
    return {
      $or: [
        // Match by G-workflow status CLOSED
        { 'grievance_workflow.status': 'CLOSED' },
        // Legacy: no G-workflow, use old workflow_status
        {
          'grievance_workflow.status': { $exists: false },
          $or: [
            { workflow_status: 'closed' },
            {
              workflow_status: { $exists: false },
              classification: 'complaint',
              'complaint.status': { $in: ['reviewed', 'sent'] }
            }
          ]
        }
      ]
    };
  }
  if (value === 'fir') {
    return {
      $or: [
        { workflow_status: 'converted_to_fir' },
        {
          workflow_status: { $exists: false },
          classification: 'complaint',
          'complaint.status': 'case_booked'
        }
      ]
    };
  }
  return {};
};

module.exports = {
  WORKFLOW_STATUSES,
  normalizeWorkflowStatus,
  inferWorkflowStatusFromLegacy,
  legacyStatusToWorkflow,
  isValidTransition,
  syncLegacyFieldsFromWorkflow,
  applyWorkflowTransition,
  canConvertToFir,
  tabToWorkflowQuery
};

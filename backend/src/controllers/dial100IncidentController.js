const Dial100Incident = require('../models/Dial100Incident');
const { createAuditLog } = require('../services/auditService');

const getDayRange = (dateStr) => {
  const date = new Date(dateStr);
  const start = new Date(date.setHours(0, 0, 0, 0));
  const end = new Date(date.setHours(23, 59, 59, 999));
  return { start, end };
};

// @desc    Get incidents by date or date range
// @route   GET /api/dial100-incidents?date=YYYY-MM-DD or ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// @access  Private
const getIncidentsByDate = async (req, res) => {
  try {
    const { date, startDate, endDate } = req.query;
    let start;
    let end;

    if (startDate || endDate) {
      if (!startDate || !endDate) {
        return res.status(400).json({ message: 'startDate and endDate are required for range queries' });
      }
      start = new Date(startDate);
      end = new Date(endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ message: 'Invalid startDate or endDate' });
      }
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (date) {
      ({ start, end } = getDayRange(date));
    } else {
      return res.status(400).json({ message: 'date or startDate/endDate query parameters are required' });
    }

    const incidents = await Dial100Incident.find({
      date: { $gte: start, $lte: end }
    }).sort({ category: 1, slNo: 1 });

    res.status(200).json({
      date: date || null,
      startDate: startDate || null,
      endDate: endDate || null,
      total: incidents.length,
      incidents
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Save incidents for a date (bulk replace)
// @route   POST /api/dial100-incidents/bulk
// @access  Private
const saveIncidentsBulk = async (req, res) => {
  try {
    const { date, incidents } = req.body;

    if (!date || !Array.isArray(incidents)) {
      return res.status(400).json({ message: 'date and incidents are required' });
    }

    const { start, end } = getDayRange(date);

    await Dial100Incident.deleteMany({
      date: { $gte: start, $lte: end }
    });

    const incidentDate = new Date(date);
    incidentDate.setHours(12, 0, 0, 0);

    const createdBy = req.user?.email || req.user?.id || 'system';

    const prepared = incidents.map((incident, index) => ({
      id: incident.id || undefined,
      date: incidentDate,
      category: incident.category,
      slNo: incident.slNo || index + 1,
      incidentDetails: incident.incidentDetails || '',
      incidentCategory: incident.incidentCategory || '',
      location: incident.location || '',
      dateTime: incident.dateTime ? new Date(incident.dateTime) : undefined,
      psJurisdiction: incident.psJurisdiction || '',
      zoneJurisdiction: incident.zoneJurisdiction || '',
      remarks: incident.remarks || '',
      mediaFiles: Array.isArray(incident.mediaFiles) ? incident.mediaFiles : [],
      status: incident.status || 'Pending',
      priority: incident.priority || 'Normal',
      callerNumber: incident.callerNumber || '',
      assignedTo: incident.assignedTo || '',
      createdBy
    }));

    const created = prepared.length > 0 ? await Dial100Incident.insertMany(prepared) : [];

    await createAuditLog(req.user, 'save', 'dial100_incidents', date, {
      count: created.length
    });

    res.status(201).json({
      message: `Saved ${created.length} incidents for ${date}`,
      count: created.length
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getIncidentsByDate,
  saveIncidentsBulk
};

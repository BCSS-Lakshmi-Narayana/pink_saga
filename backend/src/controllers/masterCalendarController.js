const MasterCalendarEvent = require('../models/MasterCalendarEvent');

// ── Seed data: recurring Telangana monitoring calendar ──────────
// Fixed-date state observances are exact; lunar and tithi-based festivals carry
// "Date varies each year" and should be re-dated annually by an operator.
//
// ⚠ Written from the OPPOSITION's side. A ruling-party calendar tracks the
// occasions the government will stage; this one also tracks the dates our own
// leadership is commemorated, and the anniversaries the government will use
// against us.
const RECURRING_SEED = [
  { slNo: 1,  occasion: 'New Year celebrations',                      date: '1 January',        monitoringRange: '30 Dec – 2 Jan',   keywords: 'New Year, Hyderabad, Tank Bund, crowd, drunk driving, traffic', remarks: 'Law & order' },
  { slNo: 2,  occasion: 'Bhogi',                                      date: '13 January',       monitoringRange: '12 Jan – 14 Jan',  keywords: 'Bhogi, భోగి, bonfire',                      remarks: 'First day of Sankranti' },
  { slNo: 3,  occasion: 'Sankranti',                                  date: '14–15 January',    monitoringRange: '13 Jan – 16 Jan',  keywords: 'Sankranti, సంక్రాంతి, Makar Sankranti, rangoli, kite', remarks: 'Largest Telugu harvest festival — heavy rural travel' },
  { slNo: 4,  occasion: 'Republic Day',                               date: '26 January',       monitoringRange: '24 Jan – 28 Jan',  keywords: 'Republic Day, 26 January, parade, national flag, Hyderabad', remarks: 'High priority' },
  { slNo: 5,  occasion: 'KCR birthday',                               date: '17 February',      monitoringRange: '16 Feb – 18 Feb',  keywords: 'KCR birthday, కేసీఆర్ పుట్టినరోజు, Chandrashekar Rao birthday', remarks: 'Client leadership — party mobilisation day' },
  { slNo: 6,  occasion: 'Medaram Sammakka Saralamma Jatara',          date: 'February (biennial, even years)', monitoringRange: '4 days', keywords: 'Medaram, మేడారం, Sammakka, Saralamma, Jatara, Mulugu', remarks: 'One of the largest tribal gatherings in India — crowd, arrangements, VIP visits' },
  { slNo: 7,  occasion: 'Maha Shivaratri',                            date: 'February/March',   monitoringRange: '± 1 day',          keywords: 'Maha Shivaratri, శివరాత్రి, Vemulawada, Keesaragutta, temple', remarks: 'Date varies each year' },
  { slNo: 8,  occasion: 'Telangana Assembly — Budget Session',        date: 'February – March', monitoringRange: 'Session duration', keywords: 'Assembly, అసెంబ్లీ, budget, walkout, question hour, adjournment', remarks: 'Our floor performance — date varies each year' },
  { slNo: 9,  occasion: 'Ugadi (Telugu New Year)',                    date: 'March/April',      monitoringRange: '± 2 days',         keywords: 'Ugadi, ఉగాది, panchangam, pachadi',           remarks: 'Date varies each year' },
  { slNo: 10, occasion: 'Sri Rama Navami — Bhadrachalam Kalyanam',    date: 'March/April',      monitoringRange: '± 2 days',         keywords: 'Rama Navami, రామనవమి, Bhadrachalam, భద్రాచలం, kalyanam, talambralu', remarks: 'State-sponsored celebration — who presents the silks is itself political' },
  { slNo: 11, occasion: 'Dr. B.R. Ambedkar Jayanti',                  date: '14 April',         monitoringRange: '13 Apr – 15 Apr',  keywords: 'Ambedkar Jayanti, అంబేడ్కర్, reservation, Dalit Bandhu', remarks: 'BC/SC politics — high salience given the 42% reservation fight' },
  { slNo: 12, occasion: 'BRS Formation Day',                          date: '27 April',         monitoringRange: '26 Apr – 28 Apr',  keywords: 'BRS formation day, బీఆర్ఎస్ ఆవిర్భావ దినోత్సవం, plenary', remarks: 'Party founded 27 Apr 2001 — our own anniversary' },
  { slNo: 13, occasion: 'Ramzan / Eid-ul-Fitr',                       date: 'Varies',           monitoringRange: '± 2 days',         keywords: 'Ramzan, Eid-ul-Fitr, Eid, Old City, Charminar', remarks: 'Significant in Hyderabad — AIMIM heartland' },
  { slNo: 14, occasion: 'Telangana Formation Day',                    date: '2 June',           monitoringRange: '1 Jun – 4 Jun',    keywords: 'Telangana Formation Day, తెలంగాణ అవతరణ దినోత్సవాలు, statehood, movement', remarks: 'The founding day of the state. Who owns the statehood legacy is a live argument between BRS and Congress' },
  { slNo: 15, occasion: 'Bakrid (Eid-ul-Adha)',                       date: 'Varies',           monitoringRange: '± 2 days',         keywords: 'Eid-ul-Adha, Bakrid',                       remarks: 'Date varies each year' },
  { slNo: 16, occasion: 'Bonalu (Ashada)',                            date: 'July',             monitoringRange: 'Season (4–5 weeks)', keywords: 'Bonalu, బోనాలు, Golconda, Secunderabad Ujjaini Mahankali, Lal Darwaza, ghatam', remarks: 'Major Hyderabad state festival — heavy political presence' },
  { slNo: 17, occasion: 'Muharram',                                   date: 'Varies',           monitoringRange: '± 2 days',         keywords: 'Muharram, Ashura, Bibi ka Alawa, Old City', remarks: 'Significant in Hyderabad' },
  { slNo: 18, occasion: 'Independence Day',                           date: '15 August',        monitoringRange: '13 Aug – 17 Aug',  keywords: 'Independence Day, 15 August, flag hoisting, Golconda', remarks: 'High priority' },
  { slNo: 19, occasion: 'Vinayaka Chavithi — Khairatabad Ganesh',     date: 'August/September', monitoringRange: '11 days to immersion', keywords: 'Vinayaka Chavithi, వినాయక చవితి, Ganesh, Khairatabad, immersion, Tank Bund, nimajjanam', remarks: 'Largest Hyderabad mobilisation of the year; Khairatabad is also the vacant seat awaiting a by-poll' },
  { slNo: 20, occasion: 'Telangana Liberation / Integration Day',     date: '17 September',     monitoringRange: '16 Sep – 18 Sep',  keywords: 'Telangana Liberation Day, Vimochana Dinam, Integration Day, Praja Palana Dinotsavam, సెప్టెంబర్ 17, Razakar, Nizam', remarks: 'POLITICALLY CONTESTED NAME. BJP says Liberation, Congress says Praja Palana, BRS said Integration — the label a post uses signals the speaker camp' },
  { slNo: 21, occasion: 'Bathukamma',                                 date: 'September/October', monitoringRange: '9 days',          keywords: 'Bathukamma, బతుకమ్మ, Saddula Bathukamma, Tank Bund, gauri', remarks: 'Signature Telangana festival, strongly identified with the statehood movement' },
  { slNo: 22, occasion: 'Dasara / Dussehra',                          date: 'September/October', monitoringRange: '± 2 days',        keywords: 'Dasara, దసరా, Jammi, Ayudha Puja',        remarks: 'Date varies each year' },
  { slNo: 23, occasion: 'Deepavali',                                  date: 'October/November', monitoringRange: '± 2 days',         keywords: 'Deepavali, దీపావళి, crackers, air quality', remarks: 'Date varies each year' },
  { slNo: 24, occasion: 'Kharif paddy procurement',                   date: 'October – January', monitoringRange: 'Season',         keywords: 'paddy, ధాన్యం, procurement, IKP centre, MSP, gunny bags, moisture, rice millers', remarks: 'Biggest farmer-grievance window in the state' },
  { slNo: 25, occasion: 'Telangana Assembly — Monsoon/Winter Session', date: 'Varies',          monitoringRange: 'Session duration', keywords: 'Assembly session, అసెంబ్లీ సమావేశాలు, no-confidence, walkout', remarks: 'Date varies' },
  { slNo: 26, occasion: 'Rythu Bharosa disbursement windows',         date: 'Varies (per crop season)', monitoringRange: 'Each instalment', keywords: 'Rythu Bharosa, రైతు భరోసా, instalment, 12000, 15000, eligibility, deposit', remarks: 'The promised-versus-delivered gap is one of our main attack lines' },
  { slNo: 27, occasion: 'TGPSC / Group exam notifications & results', date: 'All year',         monitoringRange: 'Continuous',       keywords: 'TGPSC, TSPSC, Group 1, Group 2, notification, paper leak, నిరుద్యోగం, postponement', remarks: 'Job-aspirant grievances — sustained and highly mobilised' },
  { slNo: 28, occasion: 'Christmas',                                  date: '25 December',      monitoringRange: '24 Dec – 26 Dec',  keywords: 'Christmas, church, Secunderabad',           remarks: '' },
];

// Ensure recurring seed events exist in the DB (replaces old data with updated list)
const seedRecurringEvents = async () => {
  try {
    // Remove old seed data and re-insert the current seed list
    const existing = await MasterCalendarEvent.find({ isRecurring: true, createdBy: 'system' });
    const existingSlNos = new Set(existing.map(e => e.slNo));
    const seedSlNos = new Set(RECURRING_SEED.map(e => e.slNo));

    // Delete old system events whose slNo no longer exists in seed
    for (const evt of existing) {
      if (!seedSlNos.has(evt.slNo)) {
        await MasterCalendarEvent.deleteOne({ _id: evt._id });
      }
    }

    // Upsert all seed events
    for (const evt of RECURRING_SEED) {
      await MasterCalendarEvent.findOneAndUpdate(
        { isRecurring: true, slNo: evt.slNo },
        { $set: { ...evt, isRecurring: true, createdBy: 'system' } },
        { upsert: true, new: true }
      );
    }
    console.log(`[MasterCalendar] ${RECURRING_SEED.length} Telangana recurring events seeded`);
  } catch (err) {
    console.error('[MasterCalendar] Seed error:', err.message);
  }
};

// ── CRUD controllers ──────────────────────────────────────

const listEvents = async (req, res) => {
  try {
    const { recurring } = req.query;
    const query = {};
    if (recurring === 'true') query.isRecurring = true;
    else if (recurring === 'false') query.isRecurring = false;

    const events = await MasterCalendarEvent.find(query).sort({ slNo: 1, createdAt: -1 });
    res.json(events);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const createEvent = async (req, res) => {
  try {
    const { occasion, date, monitoringRange, keywords, remarks, isRecurring } = req.body;
    if (!occasion || !date) {
      return res.status(400).json({ message: 'Occasion and date are required' });
    }

    // Auto-assign slNo
    const maxDoc = await MasterCalendarEvent.findOne({ isRecurring: !!isRecurring })
      .sort({ slNo: -1 }).select('slNo').lean();
    const slNo = (maxDoc?.slNo || 0) + 1;

    const event = await MasterCalendarEvent.create({
      slNo,
      occasion,
      date,
      monitoringRange: monitoringRange || '',
      keywords: keywords || '',
      remarks: remarks || '',
      isRecurring: !!isRecurring,
      createdBy: req.user?.email || 'unknown'
    });

    res.status(201).json(event);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const event = await MasterCalendarEvent.findOne({ id });
    if (!event) return res.status(404).json({ message: 'Event not found' });

    const allowedFields = ['occasion', 'date', 'monitoringRange', 'keywords', 'remarks'];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) event[field] = updates[field];
    }
    await event.save();
    res.json(event);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await MasterCalendarEvent.findOne({ id });
    if (!event) return res.status(404).json({ message: 'Event not found' });

    await MasterCalendarEvent.deleteOne({ id });
    res.json({ message: 'Event deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  seedRecurringEvents,
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent
};

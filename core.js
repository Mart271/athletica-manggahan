/* ==========================================================================
   ATHLETICA MANGGAHAN — domain core
   Every business rule lives here: pricing, holds, payments, cancellations,
   refunds, stock, notifications and the activity log. server.js runs it
   against data/db.json; the browser runs the same code in demo mode against
   localStorage. Nothing here trusts amounts or eligibility sent by a client.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AthleticaCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TZ_MIN = 480; // Asia/Manila, UTC+8, no daylight saving
  const ACTIVE = ['PENDING_PAYMENT', 'PAYMENT_VERIFICATION', 'CONFIRMED', 'CHECKED_IN'];
  const CANCELLABLE = ['PENDING_PAYMENT', 'PAYMENT_VERIFICATION', 'CONFIRMED'];
  const METHODS = ['GCASH', 'MAYA', 'QRPH', 'CASH'];
  const PLAYER_TYPES = {
    INDIVIDUAL: { label: 'Individual', discount: 0 },
    TEAM: { label: 'Team / league', discount: 0 },
    STUDENT: { label: 'Student', discount: 10 },
    SENIOR: { label: 'Senior / PWD', discount: 20 }
  };
  const COURT_STATUS = ['AVAILABLE', 'MAINTENANCE', 'UNAVAILABLE'];
  const OTHER_REASON = 'CR-010';

  class ApiError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  }
  const fail = (status, code, message) => { throw new ApiError(status, code, message); };

  /* ---------- Time, in facility-local terms ---------- */
  const pad = n => String(n).padStart(2, '0');
  function local(ms) {
    const d = new Date(ms + TZ_MIN * 60000);
    return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
  }
  const iso = ms => new Date(ms + TZ_MIN * 60000).toISOString().replace(/\.\d{3}Z$/, '+08:00');
  const slotMs = (date, hour) => Date.parse(date + 'T' + pad(hour) + ':00:00+08:00');
  function addDays(date, n) {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  const hourOf = hhmm => Number(String(hhmm).slice(0, 2));
  const hhmm = h => pad(h) + ':00';

  /* ---------- Small helpers ---------- */
  function hash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Plain text only: control characters and angle brackets are stripped, length is capped.
  const text = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  function normPhone(v) {
    let x = String(v || '').replace(/[\s\-().]/g, '');
    if (/^\+?63\d{10}$/.test(x)) x = '0' + x.replace(/^\+?63/, '');
    return x;
  }
  const isPhone = v => /^09\d{9}$/.test(v);
  const fmtPhone = v => v.replace(/^(\d{4})(\d{3})(\d{4})$/, '$1 $2 $3');
  const peso = n => '₱' + Math.round(n).toLocaleString('en-PH');
  const PROOF_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

  function nextId(db, prefix, width, year) {
    db.meta.seq[prefix] = (db.meta.seq[prefix] || 0) + 1;
    const n = String(db.meta.seq[prefix]).padStart(width, '0');
    return year ? `${prefix}-${year}-${n}` : `${prefix}-${n}`;
  }

  /* ---------- Seed data ---------- */
  const SPORTS = [
    { id: 'basketball', name: 'Basketball', unit: 'court', maxPlayers: 20, size: '28 × 15 m', surface: 'Indoor hardwood', tagline: 'Full-court runs, league nights, and weekend pickup games.' },
    { id: 'volleyball', name: 'Volleyball', unit: 'court', maxPlayers: 18, size: '18 × 9 m', surface: 'Indoor court', tagline: 'Regulation net height with room for six-a-side matches.' },
    { id: 'badminton', name: 'Badminton', unit: 'court', maxPlayers: 4, size: '13.4 × 6.1 m', surface: 'Indoor synthetic mat', tagline: 'Four side-by-side courts for singles, doubles, and drills.' },
    { id: 'tennis', name: 'Tennis', unit: 'court', maxPlayers: 4, size: '23.77 × 10.97 m', surface: 'Outdoor hard court', tagline: 'Doubles-width courts lit for evening play.' },
    { id: 'swimming', name: 'Swimming', unit: 'lane', maxPlayers: 6, size: '25 m lanes', surface: 'Indoor pool', tagline: 'Book a lane for laps, training sets, or lessons.' },
    { id: 'futsal', name: 'Futsal', unit: 'field', maxPlayers: 16, size: '40 × 20 m', surface: 'Indoor field', tagline: 'Five-a-side on a fast indoor pitch.' }
  ];
  const COURTS = [
    ['basketball', 'Court A', 350], ['basketball', 'Court B', 350], ['volleyball', 'Court 1', 300],
    ['badminton', 'Court 1', 200], ['badminton', 'Court 2', 200], ['badminton', 'Court 3', 200], ['badminton', 'Court 4', 200],
    ['tennis', 'Court 1', 250], ['tennis', 'Court 2', 250],
    ['swimming', 'Lane 1', 150], ['swimming', 'Lane 2', 150], ['swimming', 'Lane 3', 150], ['futsal', 'Main field', 600]
  ];
  const CATEGORIES = [{ id: 'CAT-001', name: 'Hydration' }, { id: 'CAT-002', name: 'Snacks' }, { id: 'CAT-003', name: 'Sports Essentials' }];
  const PRODUCTS = [
    ['Bottled water', '500 ml mineral water', 'CAT-001', 25, 50, 'water', true],
    ['Sports drink', '500 ml isotonic, citrus', 'CAT-001', 45, 30, 'bottle', true],
    ['Protein bar', '20 g protein, peanut', 'CAT-002', 80, 20, 'bar', true],
    ['Electrolyte water', '500 ml, zero sugar', 'CAT-001', 35, 36, 'squeeze', true],
    ['Coconut water', '330 ml can', 'CAT-001', 55, 6, 'can', false],
    ['Oat energy bar', 'Honey and oats', 'CAT-002', 60, 30, 'slab', true],
    ['Bananas', 'Lakatan, 2 pieces', 'CAT-002', 30, 18, 'banana', true],
    ['Trail mix', 'Nuts and raisins, 100 g', 'CAT-002', 70, 0, 'pouch', false],
    ['Steel water bottle', '750 ml, insulated', 'CAT-003', 390, 9, 'flask', false],
    ['Court towel', 'Microfibre, 40 × 80 cm', 'CAT-003', 180, 15, 'towel', false],
    ['Overgrip tape', 'Pack of 3, racket and bat', 'CAT-003', 150, 4, 'tape', false],
    ['Wristbands', 'Cotton, pair', 'CAT-003', 120, 20, 'band', false],
    ['Feather shuttlecocks', 'Tube of 12', 'CAT-003', 540, 7, 'shuttle', false],
    ['Ball pump', 'With 2 needles', 'CAT-003', 220, 5, 'pump', false]
  ];
  // Product illustrations in images/products/, keyed by each product's art type.
  const PRODUCT_IMAGES = { water: 'bottled-water', bottle: 'sports-drink', bar: 'protein-bar', squeeze: 'electrolyte-water', can: 'coconut-water',
    slab: 'oat-energy-bar', banana: 'bananas', pouch: 'trail-mix', flask: 'steel-water-bottle', towel: 'court-towel', tape: 'overgrip-tape',
    band: 'wristbands', shuttle: 'feather-shuttlecocks', pump: 'ball-pump' };
  const productImage = art => (PRODUCT_IMAGES[art] ? 'images/products/' + PRODUCT_IMAGES[art] + '.svg' : null);
  const REASONS = ['Personal emergency', 'Schedule conflict', 'Weather concern', 'Transportation problem', 'Health-related reason',
    'Found another schedule', 'Booked the wrong date/time', 'No longer needed', 'Financial reason', 'Other'];
  const WALK_INS = ['J. Dela Cruz', 'M. Santos', 'R. Reyes', 'A. Bautista', 'K. Mendoza', 'L. Garcia', 'D. Villanueva',
    'E. Ramos', 'P. Aquino', 'C. Navarro', 'Team Kalayaan', 'Pasig Hoopers', 'Rosario Spikers', 'Manggahan Youth League', 'Eastside FC'];
  const DEMO_USERS = [
    { username: 'athlete.demo', password: 'Athletica@123', email: 'athlete@example.com', firstName: 'Demo', lastName: 'Athlete', phone: '0917 000 0001', role: 'USER' },
    { username: 'frontdesk.admin', password: 'FrontDesk@123', email: 'frontdesk@example.com', firstName: 'Front Desk', lastName: 'Admin', phone: '0917 000 0002', role: 'ADMIN' }
  ];

  function defaultSettings() {
    return {
      facilityName: 'Manggahan Complex Sports & Recreation', brandName: 'Athletica Manggahan', slogan: 'Play Hard. Move Forward.',
      timezone: 'Asia/Manila', openHour: 6, closeHour: 22, maxHoursPerBooking: 3, bookingWindowDays: 7,
      depositPercentage: 30, reservationHoldMinutes: 15, cashPaymentMinutes: 30,
      cancellationPolicy: { enabled: true, minimumHoursBeforeBooking: 2, refundEligible: true, refundPercentage: 100 },
      paymentAccounts: {
        gcash: { name: 'Manggahan Complex Sports & Recreation', number: '09XX XXX XXXX' },
        maya: { name: 'Manggahan Complex Sports & Recreation', number: '09XX XXX XXXX' },
        qrph: { merchantName: 'Manggahan Complex Sports & Recreation', qrImage: '' }
      }
    };
  }

  async function buildSeed(hasher, t) {
    const created = iso(t);
    const db = {
      meta: { schema: 1, rev: 1, seq: {}, seededDates: [], createdAt: created },
      settings: defaultSettings(),
      users: [], sports: SPORTS.map(s => Object.assign({}, s)), courts: [], reservations: [], payments: [], paymentProofs: [],
      cancellationReasons: [], cancellations: [], categories: CATEGORIES.map(c => Object.assign({}, c)), products: [],
      cartItems: [], orders: [], orderItems: [], notifications: [], activityLogs: [], passwordResets: []
    };
    for (const u of DEMO_USERS) {
      db.users.push({
        id: nextId(db, 'USR', 3), username: u.username, email: u.email, passwordHash: await hasher.hash(u.password),
        firstName: u.firstName, lastName: u.lastName, phone: u.phone, role: u.role, status: 'ACTIVE', createdAt: created
      });
    }
    COURTS.forEach(([sportId, name, rate]) => db.courts.push({
      // depositPercentage null = use settings.depositPercentage
      id: nextId(db, 'COURT', 3), name, sportId, location: 'Manggahan Complex', hourlyRate: rate, depositPercentage: null, status: 'AVAILABLE', image: null
    }));
    PRODUCTS.forEach(([name, description, categoryId, price, stock, art, addon]) => db.products.push({
      id: nextId(db, 'PROD', 3), name, description, categoryId, price, stock, status: 'ACTIVE', art, image: productImage(art), addon
    }));
    REASONS.forEach(label => db.cancellationReasons.push({ id: nextId(db, 'CR', 3), label, active: true }));
    seedDemoHistory(db, t);
    ensureSchedule(db, t);
    return db;
  }

  /* ---------- Pricing: only ever computed here ---------- */
  function quotePrice(db, court, hours, playerType) {
    const type = PLAYER_TYPES[playerType];
    const courtPrice = court.hourlyRate * hours;
    const discountAmount = Math.round(courtPrice * type.discount / 100);
    const totalPrice = courtPrice - discountAmount;
    const depositPercentage = court.depositPercentage != null ? court.depositPercentage : db.settings.depositPercentage;
    const depositRequired = Math.round(totalPrice * depositPercentage / 100);
    return { courtPrice, discountAmount, totalPrice, depositPercentage, depositRequired, remainingBalance: totalPrice - depositRequired };
  }

  function newReservation(db, t, f) {
    const court = db.courts.find(c => c.id === f.courtId);
    const hours = f.end - f.start;
    return Object.assign({
      id: nextId(db, 'RES', 4, local(t).date.slice(0, 4)), userId: f.userId || null, courtId: court.id, date: f.date,
      startTime: hhmm(f.start), endTime: hhmm(f.end), hours,
      customerName: f.customerName, customerPhone: f.customerPhone || '', playerType: f.playerType || 'INDIVIDUAL',
      teamName: f.teamName || '', headcount: f.headcount || null, source: f.source || 'ONLINE'
    }, quotePrice(db, court, hours, f.playerType || 'INDIVIDUAL'), {
      addonItems: [], addonTotal: 0, paymentId: null, status: f.status || 'PENDING_PAYMENT', paymentStatus: f.paymentStatus || 'UNPAID',
      checkInStatus: 'NOT_CHECKED_IN', holdExpiresAt: null, paymentDueAt: null, cancellationId: null, createdAt: iso(t), updatedAt: iso(t)
    });
  }
  function newPayment(db, t, f) {
    return Object.assign({
      id: nextId(db, 'PAY', 4), userId: null, reservationId: null, orderId: null, method: 'CASH', amount: 0, depositAmount: 0, addonAmount: 0,
      status: 'UNPAID', referenceNumber: '', proofId: null, submittedAt: iso(t), verifiedAt: null, verifiedBy: null, note: '', refundedAmount: 0,
      createdAt: iso(t), updatedAt: iso(t)
    }, f);
  }

  // A walk-in schedule around today so the grid, desk queue and reports have realistic data.
  function ensureSchedule(db, t) {
    const { date: today } = local(t);
    let changed = false;
    for (let i = -3; i < db.settings.bookingWindowDays; i++) {
      const date = addDays(today, i);
      if (db.meta.seededDates.includes(date)) continue;
      db.meta.seededDates.push(date);
      changed = true;
      const past = i < 0;
      db.courts.forEach(court => {
        const r = rng(hash(date + '|' + court.id));
        let h = db.settings.openHour;
        while (h < db.settings.closeHour) {
          const p = h >= 17 ? 0.5 : (h < 9 ? 0.3 : 0.17);
          if (r() < p) {
            let len = r() < 0.4 ? 2 : 1;
            if (h + len > db.settings.closeHour) len = db.settings.closeHour - h;
            const name = WALK_INS[Math.floor(r() * WALK_INS.length)];
            const team = /^Team |League|Hoopers|Spikers| FC$/.test(name);
            const type = team ? 'TEAM' : ['INDIVIDUAL', 'INDIVIDUAL', 'STUDENT', 'SENIOR'][Math.floor(r() * 4)];
            const free = !db.reservations.some(x => x.courtId === court.id && x.date === date && ACTIVE.concat('COMPLETED').includes(x.status) &&
              hourOf(x.startTime) < h + len && h < hourOf(x.endTime));
            if (free) seedWalkIn(db, t, court, date, h, len, name, type, team, rng(hash(date + court.id + h)), past || slotMs(date, h + len) <= t, i);
            h += len;
          } else h++;
        }
      });
    }
    db.meta.seededDates = db.meta.seededDates.filter(d => d >= addDays(today, -30)).sort();
    if (Array.isArray(db.passwordResets)) db.passwordResets = db.passwordResets.filter(r => r.createdAt >= iso(t - 30 * 86400000));
    return changed;
  }
  function seedWalkIn(db, t, court, date, h, len, name, type, team, pr, past, dayOffset) {
    const method = ['CASH', 'CASH', 'GCASH', 'MAYA', 'QRPH'][Math.floor(pr() * 5)];
    const roll = pr();
    let status = past ? 'COMPLETED' : 'CONFIRMED', payStatus = 'PAID';
    if (!past && dayOffset <= 2 && roll < 0.07) { status = method === 'CASH' ? 'PENDING_PAYMENT' : 'PAYMENT_VERIFICATION'; payStatus = method === 'CASH' ? 'PENDING' : 'AWAITING_VERIFICATION'; }
    const res = newReservation(db, t, {
      courtId: court.id, date, start: h, end: h + len, customerName: name, customerPhone: '', playerType: type,
      teamName: team ? name : '', headcount: team ? 10 : null, source: 'WALK_IN', status, paymentStatus: payStatus
    });
    if (past) res.checkInStatus = pr() < 0.9 ? 'CHECKED_IN' : 'NOT_CHECKED_IN';
    if (status === 'PENDING_PAYMENT') res.paymentDueAt = res.holdExpiresAt = iso(slotMs(date, h) - 30 * 60000);
    const pay = newPayment(db, t, {
      reservationId: res.id, method, amount: res.depositRequired, depositAmount: res.depositRequired, status: payStatus,
      referenceNumber: method === 'CASH' ? '' : String(1e12 + Math.floor(pr() * 8.9e12)),
      submittedAt: iso(t - Math.floor(pr() * 5.4e6)), verifiedAt: payStatus === 'PAID' ? iso(t) : null, verifiedBy: null
    });
    res.paymentId = pay.id;
    db.reservations.push(res);
    db.payments.push(pay);
  }
  // The demo athlete starts with one of each state so every screen has something to show.
  function seedDemoHistory(db, t) {
    const { date: today } = local(t);
    const user = db.users.find(u => u.username === 'athlete.demo');
    const who = { userId: user.id, customerName: user.firstName + ' ' + user.lastName, customerPhone: user.phone };
    const court = n => db.courts[n].id;
    const make = (c, dayOff, start, len, status, payStatus, method, extra) => {
      const res = newReservation(db, t, Object.assign({ courtId: court(c), date: addDays(today, dayOff), start, end: start + len, status, paymentStatus: payStatus }, who));
      Object.assign(res, extra || {});
      const pay = newPayment(db, t, {
        userId: user.id, reservationId: res.id, method, amount: res.depositRequired, depositAmount: res.depositRequired, status: payStatus,
        referenceNumber: method === 'CASH' ? '' : String(1e12 + hash(res.id)),
        verifiedAt: payStatus === 'PAID' ? iso(t) : null, verifiedBy: payStatus === 'PAID' ? 'USR-002' : null
      });
      res.paymentId = pay.id;
      db.reservations.push(res); db.payments.push(pay);
      return { res, pay };
    };
    make(7, -2, 7, 1, 'COMPLETED', 'PAID', 'GCASH', { checkInStatus: 'CHECKED_IN' });
    make(4, 1, 17, 2, 'PAYMENT_VERIFICATION', 'AWAITING_VERIFICATION', 'MAYA');
    make(0, 2, 18, 1, 'CONFIRMED', 'PAID', 'GCASH');
    const { res } = make(2, 3, 19, 1, 'CONFIRMED', 'PAID', 'QRPH');
    const ctx = { db, t, actor: user };
    cancelReservation(ctx, res, 'CR-002', '');
  }

  /* ---------- Housekeeping, run before every request ---------- */
  function housekeeping(db, t) {
    let changed = ensureSchedule(db, t);
    const now = iso(t);
    for (const r of db.reservations) {
      if (r.status === 'PENDING_PAYMENT' && r.holdExpiresAt && r.holdExpiresAt <= now) {
        const pay = r.paymentId && db.payments.find(p => p.id === r.paymentId);
        if (pay && pay.status === 'PENDING') { pay.status = 'FAILED'; pay.note = 'Cash deposit was not received before the deadline.'; pay.updatedAt = now; }
        r.status = 'EXPIRED'; r.paymentStatus = pay ? pay.status : r.paymentStatus; r.holdExpiresAt = null; r.updatedAt = now;
        if (r.userId) notify(db, t, r.userId, 'HOLD_EXPIRED', 'Hold expired', `Your ${courtLabel(db, r.courtId)} hold on ${fmtDay(r.date)} ran out before payment, so the slot went back on the schedule.`, r.id);
        logEvent(db, t, null, 'SYSTEM', 'EXPIRE_HOLD', 'RESERVATION', r.id, 'Hold expired before payment');
        changed = true;
      }
      if ((r.status === 'CONFIRMED' || r.status === 'CHECKED_IN') && slotMs(r.date, hourOf(r.endTime)) <= t) {
        r.status = 'COMPLETED'; r.updatedAt = now; changed = true;
      }
    }
    return changed;
  }

  /* ---------- Lookups and labels ---------- */
  const sportOf = (db, court) => db.sports.find(s => s.id === court.sportId);
  function courtLabel(db, courtId) { const c = db.courts.find(x => x.id === courtId); return c ? sportOf(db, c).name + ' ' + c.name : courtId; }
  function fmtDay(date) { return new Date(date + 'T00:00:00Z').toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'long', day: 'numeric' }); }
  function fmtHour(h) { return (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? ' AM' : ' PM'); }
  const displayName = u => (u.firstName + ' ' + u.lastName).trim();
  const publicUser = u => ({ id: u.id, username: u.username, email: u.email, firstName: u.firstName, lastName: u.lastName, phone: u.phone, role: u.role, status: u.status, createdAt: u.createdAt });

  function notify(db, t, userId, type, title, message, targetId, audience) {
    db.notifications.push({ id: nextId(db, 'NOTIF', 4), userId: userId || null, audience: audience || 'USER', type, title, message, targetId: targetId || null, read: false, createdAt: iso(t) });
  }
  function logEvent(db, t, actorId, role, action, targetType, targetId, details) {
    db.activityLogs.push({ id: nextId(db, 'LOG', 4), userId: actorId || null, role, action, targetType, targetId, details, timestamp: iso(t) });
  }
  const log = (ctx, action, targetType, targetId, details) => logEvent(ctx.db, ctx.t, ctx.actor && ctx.actor.id, ctx.actor ? ctx.actor.role : 'SYSTEM', action, targetType, targetId, details);

  function occupant(db, courtId, date, hour, exceptId) {
    return db.reservations.find(r => r.id !== exceptId && r.courtId === courtId && r.date === date && ACTIVE.includes(r.status) &&
      hourOf(r.startTime) <= hour && hour < hourOf(r.endTime));
  }

  /* ---------- Cancellation rules ---------- */
  function cancelBlocker(db, r, actor, t) {
    if (!CANCELLABLE.includes(r.status)) return 'This reservation can no longer be cancelled.';
    if (slotMs(r.date, hourOf(r.startTime)) <= t) return 'This slot has already started, so it can no longer be cancelled online. Please talk to the front desk.';
    if (actor.role !== 'ADMIN' && !db.settings.cancellationPolicy.enabled) return 'Online cancellation is switched off. Please contact the front desk.';
    return '';
  }
  function cancelQuote(db, r, actor, t) {
    const policy = db.settings.cancellationPolicy;
    const startMs = slotMs(r.date, hourOf(r.startTime));
    const hoursBefore = Math.max(0, (startMs - t) / 3600000);
    const pay = r.paymentId && db.payments.find(p => p.id === r.paymentId);
    const counted = pay && (pay.status === 'PAID' || pay.status === 'AWAITING_VERIFICATION');
    const amountPaid = counted ? pay.amount : 0;
    const deadline = iso(startMs - policy.minimumHoursBeforeBooking * 3600000);
    let refundEligible = false, refundAmount = 0, refundStatus, explanation;
    if (!amountPaid) {
      refundStatus = 'NOT_APPLICABLE';
      explanation = pay && pay.status === 'PENDING' ? 'The cash deposit has not been paid yet, so there is nothing to refund.' : 'Nothing has been paid yet, so there is nothing to refund.';
    } else if (actor.role === 'ADMIN') {
      refundEligible = true; refundAmount = amountPaid; refundStatus = 'PENDING_REVIEW';
      explanation = `Cancellations made by the facility refund the full ${peso(amountPaid)} paid, after staff review.`;
    } else if (!policy.refundEligible) {
      refundStatus = 'NOT_ELIGIBLE'; explanation = 'The current cancellation policy does not offer refunds.';
    } else if (hoursBefore < policy.minimumHoursBeforeBooking) {
      refundStatus = 'NOT_ELIGIBLE';
      explanation = `Cancellations less than ${policy.minimumHoursBeforeBooking} hours before the start time are not refunded under the current cancellation policy.`;
    } else {
      refundEligible = true; refundAmount = Math.round(amountPaid * policy.refundPercentage / 100); refundStatus = refundAmount > 0 ? 'PENDING_REVIEW' : 'NOT_ELIGIBLE';
      explanation = policy.refundPercentage >= 100
        ? `You're cancelling at least ${policy.minimumHoursBeforeBooking} hours before the start time, so the ${peso(amountPaid)} you paid is eligible for a refund after staff review.`
        : `You're cancelling at least ${policy.minimumHoursBeforeBooking} hours before the start time, so ${policy.refundPercentage}% of what you paid (${peso(refundAmount)}) is eligible for a refund after staff review.`;
    }
    if (pay && pay.status === 'AWAITING_VERIFICATION' && amountPaid) explanation += ' Your payment is still being verified, so staff will confirm it arrived before sending anything back.';
    return {
      reservationId: r.id, amountPaid, depositAmount: r.depositRequired, paymentStatus: pay ? pay.status : 'UNPAID', refundEligible, refundAmount, refundStatus,
      explanation, deadline, hoursBefore: Math.round(hoursBefore * 10) / 10,
      policy: { minimumHoursBeforeBooking: policy.minimumHoursBeforeBooking, refundEligible: policy.refundEligible, refundPercentage: policy.refundPercentage }
    };
  }
  function cancelReservation(ctx, r, reasonId, otherText) {
    const { db, t, actor } = ctx;
    const reason = db.cancellationReasons.find(x => x.id === reasonId && x.active);
    if (!reason) fail(422, 'reason_required', 'Choose a reason for cancelling.');
    const other = reason.id === OTHER_REASON ? text(otherText, 200) : '';
    if (reason.id === OTHER_REASON && other.length < 3) fail(422, 'other_required', 'Tell us briefly why you are cancelling.');
    const q = cancelQuote(db, r, actor, t);
    const now = iso(t);
    const byAdmin = actor.role === 'ADMIN';
    const can = {
      id: nextId(db, 'CAN', 4), reservationId: r.id, userId: r.userId, reasonId: reason.id, reasonText: other || reason.label,
      cancelledBy: byAdmin ? 'ADMIN' : 'USER', cancelledByUserId: actor.id, cancelledAt: now, hoursBeforeStart: q.hoursBefore,
      depositAmount: r.depositRequired, amountPaid: q.amountPaid, refundEligible: q.refundEligible, refundAmount: q.refundAmount,
      refundStatus: q.refundStatus, policySnapshot: q.policy, reviewedBy: null, reviewedAt: null, completedAt: null, notes: ''
    };
    db.cancellations.push(can);
    const pay = r.paymentId && db.payments.find(p => p.id === r.paymentId);
    if (pay && pay.status === 'PENDING') { pay.status = 'FAILED'; pay.note = 'Reservation cancelled before the cash deposit was paid.'; pay.updatedAt = now; }
    r.status = 'CANCELLED'; r.cancellationId = can.id; r.holdExpiresAt = null; r.paymentDueAt = null; r.updatedAt = now;
    if (pay) r.paymentStatus = pay.status;
    const when = `${courtLabel(db, r.courtId)} reservation on ${fmtDay(r.date)}, ${fmtHour(hourOf(r.startTime))} to ${fmtHour(hourOf(r.endTime))}`;
    if (r.userId) notify(db, t, r.userId, 'RESERVATION_CANCELLED', 'Booking cancelled',
      `Your ${when} has been cancelled${byAdmin ? ' by the front desk' : ''}. Refund: ${refundPhrase(can)}.`, r.id);
    if (!byAdmin && q.amountPaid > 0) notify(db, t, null, 'CANCELLATION_REQUEST', 'New cancellation',
      `${r.customerName} cancelled the ${when}. Reason: ${can.reasonText}. Paid ${peso(q.amountPaid)}; refund ${refundPhrase(can).toLowerCase()}.`, can.id, 'ADMIN');
    log(ctx, 'CANCEL_RESERVATION', 'RESERVATION', r.id, `Cancelled by ${can.cancelledBy.toLowerCase()} (${can.reasonText}); refund ${can.refundStatus}`);
    return can;
  }
  function refundPhrase(c) {
    return { PENDING_REVIEW: `${peso(c.refundAmount)} pending review`, APPROVED: `${peso(c.refundAmount)} approved`, COMPLETED: `${peso(c.refundAmount)} sent`,
      DENIED: 'Denied', NOT_ELIGIBLE: 'Not eligible under the current cancellation policy', NOT_APPLICABLE: 'Nothing was paid' }[c.refundStatus];
  }

  /* ---------- Accounts: sign-up and password rules ---------- */
  const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const RESERVED_NAMES = ['admin', 'administrator', 'root', 'support', 'staff', 'frontdesk', 'front.desk', 'system', 'athletica', 'manggahan'];
  const COMMON_PASSWORDS = ['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123', 'abc12345', 'athletica', 'athletica1', 'manggahan1', 'iloveyou1'];
  const RESET_MINUTES = 15, RESET_MAX_ATTEMPTS = 5, RESET_MAX_PER_WINDOW = 3;
  function passwordProblem(pw, username) {
    if (pw.length < 8) return 'Use at least 8 characters.';
    if (pw.length > 128) return 'Use 128 characters or fewer.';
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use at least one letter and one number.';
    if (COMMON_PASSWORDS.includes(pw.toLowerCase())) return 'That password is too common. Choose something harder to guess.';
    if (username && username.length >= 4 && pw.toLowerCase().includes(username)) return 'Don’t include your username in your password.';
    return '';
  }
  function fieldError(fields) { const err = new ApiError(422, 'invalid', 'Check the highlighted fields.'); err.fields = fields; return err; }

  /* ---------- Validation helpers ---------- */
  function needUser(ctx) { if (!ctx.actor) fail(401, 'signin_required', 'Sign in to continue.'); return ctx.actor; }
  function needPlayer(ctx) { const u = needUser(ctx); if (u.role !== 'USER') fail(403, 'players_only', 'Staff accounts can’t book or shop as a player. Sign in with a player account.'); return u; }
  function needAdmin(ctx) { const u = needUser(ctx); if (u.role !== 'ADMIN') fail(403, 'staff_only', 'Only front desk staff can do that.'); return u; }
  function ownReservation(ctx, id) {
    const r = ctx.db.reservations.find(x => x.id === id);
    // Someone else's reservation looks exactly like a missing one.
    if (!r || (ctx.actor.role !== 'ADMIN' && r.userId !== ctx.actor.id)) fail(404, 'not_found', 'Reservation not found.');
    return r;
  }
  function validProof(p) {
    if (!p || typeof p.dataUrl !== 'string' || !PROOF_RE.test(p.dataUrl)) fail(422, 'proof_invalid', 'Payment proof could not be uploaded. Please try again with a JPG, PNG or WebP screenshot.');
    if (p.dataUrl.length > 450000) fail(422, 'proof_large', 'That image is too large. Upload a smaller screenshot.');
    return { fileName: text(p.fileName || 'receipt', 80), mimeType: p.dataUrl.slice(5, p.dataUrl.indexOf(';')), dataUrl: p.dataUrl };
  }
  function validRef(v) {
    const ref = String(v || '').replace(/[\s-]/g, '').toUpperCase();
    if (!ref) fail(422, 'ref_required', 'Enter the reference number from your receipt.');
    if (!/^[A-Z0-9]{6,20}$/.test(ref)) fail(422, 'ref_invalid', 'Reference numbers are 6 to 20 letters or digits. Check your receipt and try again.');
    return ref;
  }
  function stockShort(db, items) {
    for (const it of items) {
      const p = db.products.find(x => x.id === it.productId);
      if (!p || p.status !== 'ACTIVE') return (it.name || 'An item') + ' is no longer available.';
      if (p.stock < it.qty) return p.stock ? `Only ${p.stock} × ${p.name} left.` : `${p.name} just sold out.`;
    }
    return '';
  }
  const takeStock = (db, items) => items.forEach(it => { const p = db.products.find(x => x.id === it.productId); if (p) p.stock = Math.max(0, p.stock - it.qty); });

  function savePayment(ctx, target, method, payload, amounts) {
    const { db, t } = ctx;
    if (!METHODS.includes(method)) fail(422, 'method_required', 'Choose how you want to pay.');
    let ref = '', proof = null;
    if (method !== 'CASH') { ref = validRef(payload.referenceNumber); proof = validProof(payload.proof); }
    const pay = newPayment(db, t, Object.assign({ userId: ctx.actor.id, method, referenceNumber: ref, status: method === 'CASH' ? 'PENDING' : 'AWAITING_VERIFICATION' }, target, amounts));
    if (proof) {
      const pr = Object.assign({ id: nextId(db, 'PRF', 4), paymentId: pay.id, uploadedAt: iso(t) }, proof);
      db.paymentProofs.push(pr);
      pay.proofId = pr.id;
    }
    db.payments.push(pay);
    return pay;
  }

  /* ---------- Actions ---------- */
  const ACTIONS = {
    session: () => null,
    ping: () => null,

    async login(ctx, p) {
      const username = text(p.username, 60).toLowerCase(), password = String(p.password || '').slice(0, 200);
      const gate = ctx.throttle(username);
      if (gate) fail(429, 'throttled', gate);
      const u = ctx.db.users.find(x => x.username === username && x.status === 'ACTIVE');
      const ok = !!u && await ctx.hasher.verify(password, u.passwordHash);
      if (!ok) {
        ctx.throttle(username, true);
        logEvent(ctx.db, ctx.t, null, 'SYSTEM', 'LOGIN_FAILED', 'USER', username || '(blank)', 'Wrong username or password');
        ctx.changed = true;
        fail(401, 'bad_credentials', 'That username and password don’t match. Check them and try again.');
      }
      ctx.throttle(username, false, true);
      ctx.actor = u; ctx.signIn(u);
      log(ctx, 'LOGIN', 'USER', u.id, 'Signed in'); ctx.changed = true;
      return { user: publicUser(u) };
    },
    async 'account.register'(ctx, p) {
      const { db, t } = ctx;
      if (ctx.actor) fail(409, 'signed_in', 'You’re already signed in. Sign out to create another account.');
      const e = {};
      const firstName = text(p.firstName, 40), lastName = text(p.lastName, 40), username = text(p.username, 30).toLowerCase();
      const email = text(p.email, 120).toLowerCase(), phone = normPhone(p.phone);
      const password = String(p.password || ''), confirm = String(p.confirmPassword || '');
      if (!firstName) e.firstName = 'Enter your first name.';
      if (!lastName) e.lastName = 'Enter your last name.';
      if (!USERNAME_RE.test(username)) e.username = 'Use 3 to 30 lowercase letters, numbers, dots, dashes or underscores, starting with a letter or number.';
      else if (RESERVED_NAMES.includes(username) || db.users.some(u => u.username === username)) e.username = 'That username is taken. Try another.';
      if (!EMAIL_RE.test(email)) e.email = 'Enter an email address like name@example.com.';
      else if (db.users.some(u => u.email === email)) e.email = 'An account already uses that email. Sign in, or reset your password.';
      if (!isPhone(phone)) e.phone = 'Enter a PH mobile number, like 0917 123 4567.';
      const weak = passwordProblem(password, username);
      if (weak) e.password = weak;
      else if (password !== confirm) e.confirmPassword = 'The passwords don’t match.';
      if (Object.keys(e).length) throw fieldError(e);
      const u = {
        id: nextId(db, 'USR', 3), username, email, passwordHash: await ctx.hasher.hash(password),
        firstName, lastName, phone: fmtPhone(phone), role: 'USER', status: 'ACTIVE', createdAt: iso(t)
      };
      db.users.push(u);
      ctx.actor = u; ctx.signIn(u);
      notify(db, t, u.id, 'WELCOME', 'Welcome to Athletica Manggahan', 'Your account is ready. Book a court, pay the deposit, and show your code at the desk.', null);
      log(ctx, 'REGISTER', 'USER', u.id, 'Player account created'); ctx.changed = true;
      return { user: publicUser(u) };
    },

    // Same reply whether or not the account exists, so this can't be used to discover accounts.
    async 'account.requestReset'(ctx, p) {
      const { db, t } = ctx;
      const id = text(p.identifier, 120).toLowerCase();
      if (!id) throw fieldError({ identifier: 'Enter your username or email.' });
      const reply = { message: `If an account matches, we’ve sent a 6-digit code to its email address. It expires in ${RESET_MINUTES} minutes.` };
      const u = db.users.find(x => (x.username === id || x.email === id) && x.status === 'ACTIVE');
      if (!u) { logEvent(db, t, null, 'SYSTEM', 'PASSWORD_RESET_REQUESTED', 'USER', id, 'No matching account; nothing sent'); ctx.changed = true; return reply; }
      const since = iso(t - RESET_MINUTES * 60000);
      if (db.passwordResets.filter(r => r.userId === u.id && r.createdAt >= since).length >= RESET_MAX_PER_WINDOW) return reply;
      db.passwordResets.forEach(r => { if (r.userId === u.id && !r.usedAt && !r.revokedAt) r.revokedAt = iso(t); });
      const code = String(parseInt(ctx.random().slice(0, 10), 16) % 1000000).padStart(6, '0');
      db.passwordResets.push({ id: nextId(db, 'PWR', 4), userId: u.id, codeHash: await ctx.hasher.hash(code), attempts: 0, createdAt: iso(t), expiresAt: iso(t + RESET_MINUTES * 60000), usedAt: null, revokedAt: null });
      ctx.mail({ to: u.email, subject: 'Your Athletica Manggahan password reset code',
        text: `Hi ${u.firstName}, your password reset code is ${code}. It expires in ${RESET_MINUTES} minutes. If you didn’t ask for this, ignore this message and your password stays the same.` });
      logEvent(db, t, null, 'SYSTEM', 'PASSWORD_RESET_REQUESTED', 'USER', u.id, 'Reset code sent to the email on file');
      ctx.changed = true;
      return reply;
    },
    async 'account.resetPassword'(ctx, p) {
      const { db, t } = ctx;
      const id = text(p.identifier, 120).toLowerCase(), code = String(p.code || '').replace(/\D/g, '');
      const password = String(p.newPassword || ''), confirm = String(p.confirmPassword || '');
      const wrong = () => fail(400, 'bad_code', 'That code is wrong or has expired. Check the latest email, or request a new code.');
      if (!/^\d{6}$/.test(code)) throw fieldError({ code: 'Enter the 6-digit code from the email.' });
      const u = db.users.find(x => (x.username === id || x.email === id) && x.status === 'ACTIVE');
      const weak = passwordProblem(password, u ? u.username : '');
      if (weak) throw fieldError({ newPassword: weak });
      if (password !== confirm) throw fieldError({ confirmPassword: 'The passwords don’t match.' });
      const rec = u && db.passwordResets.filter(r => r.userId === u.id && !r.usedAt && !r.revokedAt).pop();
      if (!rec || rec.expiresAt <= iso(t)) wrong();
      if (rec.attempts >= RESET_MAX_ATTEMPTS) { rec.revokedAt = iso(t); ctx.changed = true; fail(429, 'too_many', 'Too many wrong codes. Request a new code.'); }
      if (!(await ctx.hasher.verify(code, rec.codeHash))) {
        rec.attempts++; ctx.changed = true;
        if (rec.attempts >= RESET_MAX_ATTEMPTS) { rec.revokedAt = iso(t); fail(429, 'too_many', 'Too many wrong codes. Request a new code.'); }
        wrong();
      }
      u.passwordHash = await ctx.hasher.hash(password);
      rec.usedAt = iso(t);
      // A reset signs the account out everywhere, including any session an attacker may hold.
      ctx.dropSessions(u.id);
      if (ctx.actor && ctx.actor.id === u.id) { ctx.actor = null; ctx.newToken = null; }
      ctx.throttle(u.username, false, true);
      notify(db, t, u.id, 'PASSWORD_CHANGED', 'Password changed', 'Your password was reset and every device was signed out. If this wasn’t you, contact the front desk right away.', null);
      logEvent(db, t, u.id, u.role, 'PASSWORD_RESET', 'USER', u.id, 'Password reset with an emailed code; all sessions signed out');
      ctx.changed = true;
      return { username: u.username };
    },
    logout(ctx) {
      if (ctx.actor) { log(ctx, 'LOGOUT', 'USER', ctx.actor.id, 'Signed out'); ctx.changed = true; }
      ctx.signOut(); ctx.actor = null;
      return null;
    },

    'profile.update'(ctx, p) {
      const u = needUser(ctx), e = {};
      const firstName = text(p.firstName, 40), lastName = text(p.lastName, 40), email = text(p.email, 120).toLowerCase(), phone = normPhone(p.phone);
      if (!firstName) e.firstName = 'Enter your first name.';
      if (!lastName) e.lastName = 'Enter your last name.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'Enter an email address like name@example.com.';
      if (!isPhone(phone)) e.phone = 'Enter a PH mobile number, like 0917 123 4567.';
      if (ctx.db.users.some(x => x.id !== u.id && x.email === email)) e.email = 'Another account already uses that email.';
      if (Object.keys(e).length) { const err = new ApiError(422, 'invalid', 'Check the highlighted fields.'); err.fields = e; throw err; }
      Object.assign(u, { firstName, lastName, email, phone: fmtPhone(phone) });
      log(ctx, 'UPDATE_PROFILE', 'USER', u.id, 'Profile details updated'); ctx.changed = true;
      return null;
    },

    'reservation.hold'(ctx, p) {
      const u = needPlayer(ctx), { db, t } = ctx, s = db.settings, { date: today, hour } = local(t);
      const court = db.courts.find(c => c.id === p.courtId);
      if (!court) fail(404, 'not_found', 'That court does not exist.');
      if (court.status !== 'AVAILABLE') fail(409, 'court_closed', `${courtLabel(db, court.id)} is closed for booking right now.`);
      const date = String(p.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || date > addDays(today, s.bookingWindowDays - 1)) fail(422, 'bad_date', `Choose a date within the next ${s.bookingWindowDays} days.`);
      const hours = (Array.isArray(p.hours) ? p.hours : []).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
      if (!hours.length) fail(422, 'no_hours', 'Pick at least one open hour on the grid.');
      if (hours.length > s.maxHoursPerBooking) fail(422, 'too_long', `Bookings are limited to ${s.maxHoursPerBooking} hours.`);
      if (hours.some((h, i) => i && h !== hours[i - 1] + 1)) fail(422, 'not_contiguous', 'Pick back-to-back hours on one court.');
      if (hours[0] < s.openHour || hours[hours.length - 1] >= s.closeHour) fail(422, 'closed_hours', 'Those hours are outside opening times.');
      if (date === today && hours[0] <= hour) fail(409, 'past', 'That time has already passed. Please choose a later slot.');
      const type = PLAYER_TYPES[p.playerType] ? p.playerType : null;
      if (!type) fail(422, 'player_type', 'Choose a player type.');
      const phone = normPhone(p.phone);
      if (!isPhone(phone)) fail(422, 'phone', 'Enter a PH mobile number, like 0917 123 4567.');
      let teamName = '', headcount = null;
      if (type === 'TEAM') {
        teamName = text(p.teamName, 60);
        headcount = Number(p.headcount);
        const max = sportOf(db, court).maxPlayers;
        if (!teamName) fail(422, 'team_name', 'Enter the team or league name.');
        if (!Number.isInteger(headcount) || headcount < 2 || headcount > max) fail(422, 'headcount', `Enter a whole number of players from 2 to ${max}.`);
      }
      // One unpaid hold per player: starting a new one releases the old one.
      for (const r of db.reservations) {
        if (r.userId === u.id && r.status === 'PENDING_PAYMENT' && r.paymentStatus === 'UNPAID') {
          r.status = 'EXPIRED'; r.holdExpiresAt = null; r.updatedAt = iso(t);
          log(ctx, 'RELEASE_HOLD', 'RESERVATION', r.id, 'Released when a new hold started');
        }
      }
      const start = hours[0], end = hours[hours.length - 1] + 1;
      // The double-booking guard. Requests are applied one at a time, so this check and the insert below can't interleave.
      for (let h = start; h < end; h++) if (occupant(db, court.id, date, h)) fail(409, 'slot_taken', 'This slot is no longer available. Please choose another time.');
      const clash = db.reservations.find(r => r.userId === u.id && r.date === date && ACTIVE.includes(r.status) && hourOf(r.startTime) < end && start < hourOf(r.endTime));
      if (clash) fail(409, 'player_clash', `You already have ${courtLabel(db, clash.courtId)} booked from ${fmtHour(hourOf(clash.startTime))} to ${fmtHour(hourOf(clash.endTime))} that day (${clash.id}). Pick another hour or cancel that booking first.`);
      const r = newReservation(db, t, { userId: u.id, courtId: court.id, date, start, end, customerName: displayName(u), customerPhone: fmtPhone(phone), playerType: type, teamName, headcount });
      r.holdExpiresAt = iso(t + s.reservationHoldMinutes * 60000);
      db.reservations.push(r);
      if (!u.phone) u.phone = fmtPhone(phone);
      log(ctx, 'CREATE_RESERVATION', 'RESERVATION', r.id, `Held ${courtLabel(db, court.id)} on ${date}, ${hhmm(start)}–${hhmm(end)}`);
      ctx.changed = true;
      return { reservationId: r.id };
    },

    'reservation.addons'(ctx, p) {
      needPlayer(ctx);
      const { db } = ctx, r = ownReservation(ctx, p.reservationId);
      if (r.status !== 'PENDING_PAYMENT' || r.paymentStatus !== 'UNPAID') fail(409, 'locked', 'Add-ons can only change before you pay.');
      const items = [];
      for (const it of Array.isArray(p.items) ? p.items : []) {
        const prod = db.products.find(x => x.id === it.productId && x.status === 'ACTIVE' && x.addon);
        const qty = Number(it.qty);
        if (!prod || !Number.isInteger(qty) || qty < 1) continue;
        if (qty > prod.stock) fail(409, 'stock', prod.stock ? `Only ${prod.stock} × ${prod.name} left in stock.` : `${prod.name} is out of stock.`);
        items.push({ productId: prod.id, name: prod.name, qty: Math.min(qty, 20), unitPrice: prod.price });
      }
      r.addonItems = items;
      r.addonTotal = items.reduce((n, it) => n + it.unitPrice * it.qty, 0);
      r.updatedAt = iso(ctx.t); ctx.changed = true;
      return null;
    },

    'reservation.release'(ctx, p) {
      needPlayer(ctx);
      const r = ownReservation(ctx, p.reservationId);
      if (r.status !== 'PENDING_PAYMENT' || r.paymentStatus !== 'UNPAID') fail(409, 'locked', 'Only an unpaid hold can be released. Use Cancel booking instead.');
      r.status = 'EXPIRED'; r.holdExpiresAt = null; r.updatedAt = iso(ctx.t);
      log(ctx, 'RELEASE_HOLD', 'RESERVATION', r.id, 'Released by the player during checkout'); ctx.changed = true;
      return null;
    },

    'payment.submit'(ctx, p) {
      needPlayer(ctx);
      const { db, t } = ctx, r = ownReservation(ctx, p.reservationId), now = iso(t);
      if (r.status !== 'PENDING_PAYMENT') fail(409, 'not_payable', 'This reservation no longer needs payment.');
      if (r.holdExpiresAt && r.holdExpiresAt <= now) fail(409, 'expired', 'This slot is no longer held. Please choose another time.');
      const short = stockShort(db, r.addonItems);
      if (short) fail(409, 'stock', short + ' Go back to review and change your add-ons.');
      const method = String(p.method || '');
      const prev = r.paymentId && db.payments.find(x => x.id === r.paymentId);
      const pay = savePayment(ctx, { reservationId: r.id }, method, p, { amount: r.depositRequired + r.addonTotal, depositAmount: r.depositRequired, addonAmount: r.addonTotal });
      if (prev && prev.status === 'PENDING') { prev.status = 'FAILED'; prev.note = 'Replaced by an online payment.'; prev.updatedAt = now; }
      r.paymentId = pay.id; r.paymentStatus = pay.status; r.updatedAt = now;
      if (method === 'CASH') {
        r.paymentDueAt = r.holdExpiresAt = iso(t + db.settings.cashPaymentMinutes * 60000);
      } else {
        r.status = 'PAYMENT_VERIFICATION'; r.holdExpiresAt = null; r.paymentDueAt = null;
      }
      notify(db, t, null, 'PAYMENT_SUBMITTED', method === 'CASH' ? 'Cash deposit expected' : 'Payment to verify',
        `${r.customerName}: ${peso(pay.amount)} by ${method === 'CASH' ? 'cash at the desk' : method} for ${r.id} (${courtLabel(db, r.courtId)}, ${fmtDay(r.date)}).`, pay.id, 'ADMIN');
      log(ctx, 'SUBMIT_PAYMENT', 'PAYMENT', pay.id, `${method} ${peso(pay.amount)} for ${r.id}`);
      ctx.changed = true;
      return { paymentId: pay.id };
    },

    'reservation.checkin'(ctx, p) {
      needAdmin(ctx);
      const r = ownReservation(ctx, p.reservationId), { date: today } = local(ctx.t);
      if (r.status !== 'CONFIRMED') fail(409, 'not_confirmed', 'Only confirmed reservations can be checked in.');
      if (r.date !== today) fail(409, 'not_today', 'Players can only check in on the day of their booking.');
      r.status = 'CHECKED_IN'; r.checkInStatus = 'CHECKED_IN'; r.checkedInAt = iso(ctx.t); r.updatedAt = iso(ctx.t);
      log(ctx, 'CHECK_IN_USER', 'RESERVATION', r.id, `${r.customerName} checked in; balance ${peso(r.remainingBalance)} collected at the desk`);
      ctx.changed = true;
      return null;
    },

    'reservation.cancelQuote'(ctx, p) {
      needUser(ctx);
      const r = ownReservation(ctx, p.reservationId);
      const blocked = cancelBlocker(ctx.db, r, ctx.actor, ctx.t);
      if (blocked) fail(409, 'not_cancellable', blocked);
      return cancelQuote(ctx.db, r, ctx.actor, ctx.t);
    },
    'reservation.cancel'(ctx, p) {
      needUser(ctx);
      const r = ownReservation(ctx, p.reservationId);
      const blocked = cancelBlocker(ctx.db, r, ctx.actor, ctx.t);
      if (blocked) fail(409, 'not_cancellable', blocked);
      const can = cancelReservation(ctx, r, String(p.reasonId || ''), p.otherText);
      ctx.changed = true;
      return { cancellationId: can.id };
    },

    'payment.review'(ctx, p) {
      needAdmin(ctx);
      const { db, t } = ctx, now = iso(t);
      const pay = db.payments.find(x => x.id === p.paymentId);
      if (!pay) fail(404, 'not_found', 'Payment not found.');
      const decision = p.decision;
      const r = pay.reservationId && db.reservations.find(x => x.id === pay.reservationId);
      const o = pay.orderId && db.orders.find(x => x.id === pay.orderId);
      if (decision === 'approve') {
        if (!['AWAITING_VERIFICATION', 'PENDING'].includes(pay.status)) fail(409, 'reviewed', 'This payment was already reviewed.');
        if (r && r.status === 'CANCELLED') fail(409, 'cancelled', 'This reservation was cancelled. Handle the money through its refund instead.');
        if (r && !['PENDING_PAYMENT', 'PAYMENT_VERIFICATION'].includes(r.status)) fail(409, 'inactive', 'This reservation expired before the payment was verified, so the slot may have been re-booked. Refund the player at the desk.');
        if (o && !['AWAITING_VERIFICATION', 'PENDING_COUNTER_PAYMENT'].includes(o.status)) fail(409, 'inactive', 'This order is no longer waiting for payment.');
        const items = r ? r.addonItems : o ? db.orderItems.filter(i => i.orderId === o.id) : [];
        const short = stockShort(db, items);
        if (short) fail(409, 'stock', short + ' Update inventory before approving.');
        takeStock(db, items);
        Object.assign(pay, { status: 'PAID', verifiedAt: now, verifiedBy: ctx.actor.id, note: '', updatedAt: now });
        if (r) {
          Object.assign(r, { status: 'CONFIRMED', paymentStatus: 'PAID', holdExpiresAt: null, paymentDueAt: null, updatedAt: now });
          if (r.userId) notify(db, t, r.userId, 'PAYMENT_VERIFIED', 'Reservation confirmed', `${peso(pay.amount)} received. Your ${courtLabel(db, r.courtId)} slot on ${fmtDay(r.date)} is confirmed.`, r.id);
        }
        if (o) {
          Object.assign(o, { status: 'READY_FOR_PICKUP', updatedAt: now });
          notify(db, t, o.userId, 'ORDER_READY', 'Order ready', `Order ${o.id} is paid and waiting at the front desk.`, o.id);
        }
        log(ctx, 'VERIFY_PAYMENT', 'PAYMENT', pay.id, `${pay.method} ${peso(pay.amount)} approved for ${r ? r.id : o.id}`);
      } else if (decision === 'reject' || decision === 'reupload') {
        if (pay.status !== 'AWAITING_VERIFICATION') fail(409, 'reviewed', 'Only payments awaiting verification can be rejected.');
        const note = decision === 'reupload' ? 'The screenshot was unclear. Upload a clearer photo of the receipt that shows the amount and reference number.'
          : text(p.note, 200) || 'We couldn’t match this payment. Check the amount and reference number, then submit again.';
        Object.assign(pay, { status: 'FAILED', note, verifiedAt: now, verifiedBy: ctx.actor.id, updatedAt: now });
        if (r) {
          Object.assign(r, { status: 'PENDING_PAYMENT', paymentStatus: 'FAILED', holdExpiresAt: iso(t + db.settings.reservationHoldMinutes * 60000), updatedAt: now });
          if (r.userId) notify(db, t, r.userId, 'PAYMENT_REJECTED', decision === 'reupload' ? 'New screenshot needed' : 'Payment not verified', note + ` Resubmit within ${db.settings.reservationHoldMinutes} minutes to keep ${r.id}.`, r.id);
        }
        if (o) {
          Object.assign(o, { status: 'PAYMENT_REJECTED', updatedAt: now });
          notify(db, t, o.userId, 'PAYMENT_REJECTED', 'Order payment not verified', note, o.id);
        }
        log(ctx, decision === 'reupload' ? 'REQUEST_REUPLOAD' : 'REJECT_PAYMENT', 'PAYMENT', pay.id, note);
      } else fail(422, 'bad_decision', 'Choose approve, reject or request re-upload.');
      ctx.changed = true;
      return null;
    },

    'refund.decide'(ctx, p) {
      needAdmin(ctx);
      const { db, t } = ctx, now = iso(t);
      const c = db.cancellations.find(x => x.id === p.cancellationId);
      if (!c) fail(404, 'not_found', 'Cancellation not found.');
      const r = db.reservations.find(x => x.id === c.reservationId);
      const pay = r && r.paymentId && db.payments.find(x => x.id === r.paymentId);
      const note = text(p.note, 200);
      if (p.decision === 'approve') {
        if (c.refundStatus !== 'PENDING_REVIEW') fail(409, 'reviewed', 'This refund was already reviewed.');
        Object.assign(c, { refundStatus: 'APPROVED', reviewedBy: ctx.actor.id, reviewedAt: now, notes: note || c.notes });
        if (pay && pay.status === 'AWAITING_VERIFICATION') Object.assign(pay, { status: 'PAID', verifiedAt: now, verifiedBy: ctx.actor.id, note: 'Verified during refund review.', updatedAt: now });
        if (pay && r) r.paymentStatus = pay.status;
        if (c.userId) notify(db, t, c.userId, 'REFUND_APPROVED', 'Refund approved', `Your ${peso(c.refundAmount)} refund for ${c.reservationId} is approved. The front desk will send it and let you know when it's done.`, c.reservationId);
        log(ctx, 'APPROVE_REFUND', 'CANCELLATION', c.id, `${peso(c.refundAmount)} approved for ${c.reservationId}`);
      } else if (p.decision === 'deny') {
        if (c.refundStatus !== 'PENDING_REVIEW') fail(409, 'reviewed', 'This refund was already reviewed.');
        if (!note) fail(422, 'note_required', 'Add a short note explaining why the refund is denied.');
        Object.assign(c, { refundStatus: 'DENIED', reviewedBy: ctx.actor.id, reviewedAt: now, notes: note });
        if (pay && pay.status === 'AWAITING_VERIFICATION') { Object.assign(pay, { status: 'FAILED', note, verifiedAt: now, verifiedBy: ctx.actor.id, updatedAt: now }); if (r) r.paymentStatus = pay.status; }
        if (c.userId) notify(db, t, c.userId, 'REFUND_DENIED', 'Refund denied', `The refund for ${c.reservationId} was denied: ${note}`, c.reservationId);
        log(ctx, 'REJECT_REFUND', 'CANCELLATION', c.id, note);
      } else if (p.decision === 'complete') {
        if (c.refundStatus !== 'APPROVED') fail(409, 'not_approved', 'Approve the refund before marking it sent.');
        Object.assign(c, { refundStatus: 'COMPLETED', completedAt: now, notes: note || c.notes });
        if (pay) {
          pay.refundedAmount = c.refundAmount;
          pay.status = c.refundAmount >= pay.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
          pay.updatedAt = now;
          r.paymentStatus = pay.status; r.updatedAt = now;
        }
        if (c.userId) notify(db, t, c.userId, 'REFUND_COMPLETED', 'Refund sent', `The front desk has sent your ${peso(c.refundAmount)} refund for ${c.reservationId}.`, c.reservationId);
        log(ctx, 'COMPLETE_REFUND', 'CANCELLATION', c.id, `${peso(c.refundAmount)} marked as sent`);
      } else fail(422, 'bad_decision', 'Choose approve, deny or mark as sent.');
      ctx.changed = true;
      return null;
    },

    'cart.set'(ctx, p) {
      const u = needPlayer(ctx), { db, t } = ctx;
      const prod = db.products.find(x => x.id === p.productId && x.status === 'ACTIVE');
      if (!prod) fail(404, 'not_found', 'That product is no longer available.');
      const qty = Number(p.qty);
      if (!Number.isInteger(qty) || qty < 0) fail(422, 'qty', 'Enter a whole number.');
      if (qty > prod.stock) fail(409, 'stock', prod.stock ? `Only ${prod.stock} × ${prod.name} left in stock.` : `${prod.name} is out of stock.`);
      const line = db.cartItems.find(x => x.userId === u.id && x.productId === prod.id);
      if (!qty) db.cartItems = db.cartItems.filter(x => x !== line);
      else if (line) { line.qty = qty; line.updatedAt = iso(t); }
      else db.cartItems.push({ id: nextId(db, 'CI', 4), userId: u.id, productId: prod.id, qty, addedAt: iso(t), updatedAt: iso(t) });
      ctx.changed = true;
      return null;
    },

    'order.place'(ctx, p) {
      const u = needPlayer(ctx), { db, t } = ctx, now = iso(t);
      const lines = db.cartItems.filter(x => x.userId === u.id);
      if (!lines.length) fail(409, 'empty', 'Your cart is empty.');
      const items = lines.map(l => { const pr = db.products.find(x => x.id === l.productId); return { productId: l.productId, name: pr ? pr.name : 'Item', qty: l.qty, unitPrice: pr ? pr.price : 0 }; });
      const short = stockShort(db, items);
      if (short) fail(409, 'stock', short + ' Update your cart to continue.');
      const name = text(p.contactName, 60), phone = normPhone(p.contactPhone);
      if (name.length < 2) fail(422, 'name', 'Enter the name for pickup.');
      if (!isPhone(phone)) fail(422, 'phone', 'Enter a PH mobile number, like 0917 123 4567.');
      const total = items.reduce((n, it) => n + it.unitPrice * it.qty, 0);
      const method = String(p.method || '');
      const order = { id: nextId(db, 'ORD', 4), userId: u.id, contactName: name, contactPhone: fmtPhone(phone), total, status: method === 'CASH' ? 'PENDING_COUNTER_PAYMENT' : 'AWAITING_VERIFICATION', paymentId: null, createdAt: now, updatedAt: now };
      const pay = savePayment(ctx, { orderId: order.id }, method, p, { amount: total });
      order.paymentId = pay.id;
      db.orders.push(order);
      items.forEach(it => db.orderItems.push({ id: nextId(db, 'OI', 4), orderId: order.id, productId: it.productId, name: it.name, qty: it.qty, unitPrice: it.unitPrice, lineTotal: it.unitPrice * it.qty }));
      db.cartItems = db.cartItems.filter(x => x.userId !== u.id);
      notify(db, t, null, 'ORDER_PLACED', 'New shop order', `${name}: ${order.id}, ${peso(total)} by ${method === 'CASH' ? 'cash at the counter' : method}.`, order.id, 'ADMIN');
      log(ctx, 'PLACE_ORDER', 'ORDER', order.id, `${items.length} item types, ${peso(total)}, ${method}`);
      ctx.changed = true;
      return { orderId: order.id };
    },
    'order.cancel'(ctx, p) {
      needUser(ctx);
      const { db, t } = ctx, now = iso(t), admin = ctx.actor.role === 'ADMIN';
      const o = db.orders.find(x => x.id === p.orderId && (admin || x.userId === ctx.actor.id));
      if (!o) fail(404, 'not_found', 'Order not found.');
      const allowed = admin ? ['PENDING_COUNTER_PAYMENT', 'AWAITING_VERIFICATION', 'PAYMENT_REJECTED'] : ['PENDING_COUNTER_PAYMENT', 'PAYMENT_REJECTED'];
      if (!allowed.includes(o.status)) fail(409, 'locked', admin ? 'Paid orders can’t be cancelled here.' : 'This order is being processed. Ask the front desk to cancel it.');
      const pay = db.payments.find(x => x.id === o.paymentId);
      if (pay && ['PENDING', 'AWAITING_VERIFICATION'].includes(pay.status)) { pay.status = 'FAILED'; pay.note = 'Order cancelled.'; pay.updatedAt = now; }
      o.status = 'CANCELLED'; o.updatedAt = now;
      if (admin && o.userId) notify(db, t, o.userId, 'ORDER_CANCELLED', 'Order cancelled', `Order ${o.id} was cancelled by the front desk.`, o.id);
      log(ctx, 'CANCEL_ORDER', 'ORDER', o.id, admin ? 'Cancelled by the front desk' : 'Cancelled by the player');
      ctx.changed = true;
      return null;
    },
    'order.collect'(ctx, p) {
      needAdmin(ctx);
      const o = ctx.db.orders.find(x => x.id === p.orderId);
      if (!o || o.status !== 'READY_FOR_PICKUP') fail(409, 'not_ready', 'Only paid orders can be marked collected.');
      o.status = 'COLLECTED'; o.updatedAt = iso(ctx.t);
      log(ctx, 'COLLECT_ORDER', 'ORDER', o.id, 'Handed over at the desk'); ctx.changed = true;
      return null;
    },

    'notifications.read'(ctx, p) {
      const u = needUser(ctx);
      const ids = Array.isArray(p.ids) ? p.ids.map(String) : null;
      ctx.db.notifications.forEach(n => {
        const mine = u.role === 'ADMIN' ? n.audience === 'ADMIN' : n.userId === u.id && n.audience === 'USER';
        if (mine && !n.read && (!ids || ids.includes(n.id))) { n.read = true; ctx.changed = true; }
      });
      return null;
    },

    'settings.update'(ctx, p) {
      needAdmin(ctx);
      const s = ctx.db.settings, e = {};
      const num = (k, v, lo, hi) => { const x = Number(v); if (!Number.isInteger(x) || x < lo || x > hi) e[k] = `Enter a whole number from ${lo} to ${hi}.`; return x; };
      const next = {
        depositPercentage: num('depositPercentage', p.depositPercentage, 0, 100),
        reservationHoldMinutes: num('reservationHoldMinutes', p.reservationHoldMinutes, 5, 60),
        cashPaymentMinutes: num('cashPaymentMinutes', p.cashPaymentMinutes, 10, 240),
        policy: {
          enabled: !!p.cancellationEnabled, refundEligible: !!p.refundEligible,
          minimumHoursBeforeBooking: num('minimumHoursBeforeBooking', p.minimumHoursBeforeBooking, 0, 168),
          refundPercentage: num('refundPercentage', p.refundPercentage, 0, 100)
        }
      };
      const acct = {};
      ['gcash', 'maya'].forEach(k => {
        const number = text(p[k + 'Number'], 20), name = text(p[k + 'Name'], 80);
        if (!/x/i.test(number) && !isPhone(normPhone(number))) e[k + 'Number'] = 'Enter an 11-digit mobile number like 0917 123 4567, or keep the XX placeholder.';
        if (name.length < 2) e[k + 'Name'] = 'Enter the account name players will see.';
        acct[k] = { name, number: /x/i.test(number) ? number : fmtPhone(normPhone(number)) };
      });
      const merchant = text(p.qrMerchantName, 80);
      if (merchant.length < 2) e.qrMerchantName = 'Enter the merchant name shown with the QR code.';
      let qrImage = s.paymentAccounts.qrph.qrImage;
      if (p.qrImage === '') qrImage = '';
      else if (p.qrImage) qrImage = validProof({ dataUrl: p.qrImage }).dataUrl;
      if (Object.keys(e).length) { const err = new ApiError(422, 'invalid', 'Check the highlighted fields.'); err.fields = e; throw err; }
      s.depositPercentage = next.depositPercentage; s.reservationHoldMinutes = next.reservationHoldMinutes; s.cashPaymentMinutes = next.cashPaymentMinutes;
      s.cancellationPolicy = next.policy;
      s.paymentAccounts = { gcash: acct.gcash, maya: acct.maya, qrph: { merchantName: merchant, qrImage } };
      log(ctx, 'UPDATE_SETTINGS', 'SETTINGS', 'settings', `Deposit ${s.depositPercentage}%, hold ${s.reservationHoldMinutes} min, refund ${next.policy.refundPercentage}% when cancelled ${next.policy.minimumHoursBeforeBooking}+ h ahead`);
      ctx.changed = true;
      return null;
    },

    'court.update'(ctx, p) {
      needAdmin(ctx);
      const c = ctx.db.courts.find(x => x.id === p.courtId);
      if (!c) fail(404, 'not_found', 'Court not found.');
      const rate = Number(p.hourlyRate), inherit = p.depositPercentage === '' || p.depositPercentage == null, dep = inherit ? null : Number(p.depositPercentage);
      if (!COURT_STATUS.includes(p.status)) fail(422, 'status', 'Choose a court status.');
      if (!Number.isInteger(rate) || rate < 50 || rate > 10000) fail(422, 'rate', 'Enter an hourly rate from ₱50 to ₱10,000.');
      if (!inherit && (!Number.isInteger(dep) || dep < 0 || dep > 100)) fail(422, 'deposit', 'Enter a deposit percentage from 0 to 100, or leave it blank to use the default.');
      const pct = v => (v == null ? 'default deposit' : v + '% deposit');
      const before = `${c.status}, ${peso(c.hourlyRate)}/h, ${pct(c.depositPercentage)}`;
      Object.assign(c, { status: p.status, hourlyRate: rate, depositPercentage: dep });
      log(ctx, 'UPDATE_COURT', 'COURT', c.id, `${courtLabel(ctx.db, c.id)}: ${before} → ${c.status}, ${peso(rate)}/h, ${pct(dep)}`);
      ctx.changed = true;
      return null;
    },

    'product.update'(ctx, p) {
      needAdmin(ctx);
      const pr = ctx.db.products.find(x => x.id === p.productId);
      if (!pr) fail(404, 'not_found', 'Product not found.');
      if (p.stockDelta != null) {
        const d = Number(p.stockDelta);
        if (!Number.isInteger(d) || Math.abs(d) > 1000) fail(422, 'stock', 'Enter a whole number.');
        pr.stock = Math.max(0, pr.stock + d);
        log(ctx, 'UPDATE_STOCK', 'PRODUCT', pr.id, `${pr.name}: ${d > 0 ? '+' : ''}${d}, now ${pr.stock}`);
      }
      if (p.price != null) {
        const price = Number(p.price);
        if (!Number.isInteger(price) || price < 1 || price > 100000) fail(422, 'price', 'Enter a price from ₱1.');
        pr.price = price;
        log(ctx, 'UPDATE_PRODUCT', 'PRODUCT', pr.id, `${pr.name}: price ${peso(price)}`);
      }
      if (p.status) {
        if (!['ACTIVE', 'INACTIVE'].includes(p.status)) fail(422, 'status', 'Choose active or hidden.');
        pr.status = p.status;
        log(ctx, 'UPDATE_PRODUCT', 'PRODUCT', pr.id, `${pr.name}: ${p.status === 'ACTIVE' ? 'shown in the shop' : 'hidden from the shop'}`);
      }
      ctx.changed = true;
      return null;
    }
  };

  /* ---------- What each role is allowed to see ---------- */
  function decorate(db, r, actor, t) {
    const court = db.courts.find(c => c.id === r.courtId), sport = sportOf(db, court);
    const pay = r.paymentId ? db.payments.find(p => p.id === r.paymentId) : null;
    const out = Object.assign({}, r, {
      start: hourOf(r.startTime), end: hourOf(r.endTime), courtName: court.name, sportId: sport.id, sportName: sport.name,
      payment: pay ? paymentView(db, pay) : null,
      cancellation: r.cancellationId ? db.cancellations.find(c => c.id === r.cancellationId) || null : null
    });
    if (actor) {
      const blocked = cancelBlocker(db, r, actor, t);
      out.canCancel = !blocked && (actor.role === 'ADMIN' || r.userId === actor.id);
      out.refundDeadline = iso(slotMs(r.date, hourOf(r.startTime)) - db.settings.cancellationPolicy.minimumHoursBeforeBooking * 3600000);
    }
    return out;
  }
  function paymentView(db, pay) {
    const proof = pay.proofId ? db.paymentProofs.find(x => x.id === pay.proofId) : null;
    return Object.assign({}, pay, { proof: proof ? proof.dataUrl : '' });
  }
  function orderView(db, o) {
    const pay = db.payments.find(p => p.id === o.paymentId);
    return Object.assign({}, o, { items: db.orderItems.filter(i => i.orderId === o.id), payment: pay ? paymentView(db, pay) : null });
  }

  function buildView(db, actor, t) {
    const { date: today, hour } = local(t), s = db.settings;
    const admin = actor && actor.role === 'ADMIN';
    const view = {
      rev: db.meta.rev, now: iso(t), today, hour, me: actor ? publicUser(actor) : null,
      settings: JSON.parse(JSON.stringify(s)), sports: db.sports, courts: db.courts,
      reasons: db.cancellationReasons.filter(r => r.active), categories: db.categories,
      products: admin ? db.products : db.products.filter(p => p.status === 'ACTIVE'),
      occupancy: {}
    };
    for (let i = 0; i < s.bookingWindowDays; i++) {
      const date = addDays(today, i), day = {};
      db.reservations.forEach(r => {
        if (r.date !== date || !ACTIVE.includes(r.status)) return;
        const st = r.status === 'PENDING_PAYMENT' ? (r.paymentStatus === 'UNPAID' ? 'held' : 'pend') : r.status === 'PAYMENT_VERIFICATION' ? 'pend' : 'taken';
        const mine = !!actor && r.userId === actor.id;
        for (let h = hourOf(r.startTime); h < hourOf(r.endTime); h++) {
          const cell = { s: st };
          if (mine) cell.mine = 1;
          if (admin) cell.id = r.id;
          (day[r.courtId] = day[r.courtId] || {})[h] = cell;
        }
      });
      view.occupancy[date] = day;
    }
    if (!actor) return view;
    if (!admin) {
      view.reservations = db.reservations.filter(r => r.userId === actor.id).map(r => decorate(db, r, actor, t));
      view.cart = db.cartItems.filter(c => c.userId === actor.id).map(c => ({ productId: c.productId, qty: c.qty }));
      view.orders = db.orders.filter(o => o.userId === actor.id).map(o => orderView(db, o));
      view.notifications = db.notifications.filter(n => n.audience === 'USER' && n.userId === actor.id).slice(-40).reverse();
      return view;
    }
    const from = addDays(today, -14);
    const keep = new Set(db.cancellations.map(c => c.reservationId));
    view.reservations = db.reservations.filter(r => r.date >= from || keep.has(r.id) || ['PENDING_PAYMENT', 'PAYMENT_VERIFICATION'].includes(r.status)).map(r => decorate(db, r, actor, t));
    const weekAgo = iso(t - 7 * 86400000);
    view.payments = db.payments.filter(p => ['AWAITING_VERIFICATION', 'PENDING'].includes(p.status) || (p.verifiedBy && p.verifiedAt >= weekAgo)).map(p => paymentView(db, p));
    view.cancellations = db.cancellations.slice().reverse();
    view.orders = db.orders.slice().reverse().map(o => orderView(db, o));
    view.notifications = db.notifications.filter(n => n.audience === 'ADMIN').slice(-60).reverse();
    view.logs = db.activityLogs.slice(-250).reverse();
    view.users = db.users.map(publicUser);
    view.customers = customers(db);
    view.reports = reports(db, t);
    return view;
  }

  function customers(db) {
    const map = new Map();
    const row = key => { if (!map.has(key)) map.set(key, { key, name: '', username: '', email: '', phone: '', type: 'WALK_IN', reservations: 0, cancellations: 0, paid: 0, lastVisit: '' }); return map.get(key); };
    db.users.filter(u => u.role === 'USER').forEach(u => Object.assign(row(u.id), { name: displayName(u), username: u.username, email: u.email, phone: u.phone, type: 'ACCOUNT' }));
    db.reservations.forEach(r => {
      const c = row(r.userId || 'walkin:' + r.customerName);
      if (!c.name) c.name = r.customerName;
      c.reservations++;
      if (r.status === 'CANCELLED') c.cancellations++;
      const pay = r.paymentId && db.payments.find(p => p.id === r.paymentId);
      if (pay && pay.status === 'PAID') c.paid += pay.amount;
      if (r.date > c.lastVisit && r.status !== 'CANCELLED') c.lastVisit = r.date;
    });
    return [...map.values()].sort((a, b) => (a.type === b.type ? b.reservations - a.reservations : a.type === 'ACCOUNT' ? -1 : 1));
  }

  function reports(db, t) {
    const { date: today } = local(t), s = db.settings;
    const to = addDays(today, s.bookingWindowDays - 1);
    const win = db.reservations.filter(r => r.date >= today && r.date <= to);
    const byStatus = {};
    win.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
    const booked = win.filter(r => ACTIVE.includes(r.status)).reduce((n, r) => n + r.hours, 0);
    const capacity = db.courts.filter(c => c.status === 'AVAILABLE').length * (s.closeHour - s.openHour) * s.bookingWindowDays;
    const since = addDays(today, -30);
    const recent = db.reservations.filter(r => r.date >= since && r.date <= to);
    const paidDeposits = db.payments.filter(p => p.reservationId && p.status === 'PAID' && recent.some(r => r.id === p.reservationId)).reduce((n, p) => n + p.depositAmount, 0);
    const shopSales = db.orders.filter(o => ['READY_FOR_PICKUP', 'COLLECTED'].includes(o.status)).reduce((n, o) => n + o.total, 0) +
      db.payments.filter(p => p.reservationId && p.status === 'PAID').reduce((n, p) => n + (p.addonAmount || 0), 0);
    const refunds = {};
    ['PENDING_REVIEW', 'APPROVED', 'COMPLETED', 'DENIED', 'NOT_ELIGIBLE', 'NOT_APPLICABLE'].forEach(k => {
      const list = db.cancellations.filter(c => c.refundStatus === k);
      refunds[k] = { count: list.length, amount: list.reduce((n, c) => n + c.refundAmount, 0) };
    });
    const reasons = db.cancellationReasons.map(r => ({ label: r.label, count: db.cancellations.filter(c => c.reasonId === r.id).length })).filter(r => r.count).sort((a, b) => b.count - a.count);
    const finished = db.reservations.filter(r => r.status === 'COMPLETED' && r.date >= since);
    const bySport = db.sports.map(sp => {
      const ids = db.courts.filter(c => c.sportId === sp.id).map(c => c.id);
      return { label: sp.name, hours: win.filter(r => ids.includes(r.courtId) && ACTIVE.includes(r.status)).reduce((n, r) => n + r.hours, 0), capacity: ids.length * (s.closeHour - s.openHour) * s.bookingWindowDays };
    });
    return {
      window: { from: today, to }, byStatus, bookedHours: booked, capacityHours: capacity, utilization: capacity ? Math.round(booked / capacity * 100) : 0,
      depositsCollected30d: paidDeposits, shopSales, refunds, reasons, bySport,
      noShows30d: finished.filter(r => r.checkInStatus !== 'CHECKED_IN').length, completed30d: finished.length,
      cancellations30d: db.cancellations.filter(c => c.cancelledAt >= iso(t - 30 * 86400000)).length
    };
  }

  /* ---------- The service: one entry point for server and demo ---------- */
  function createService(opts) {
    // mailer(message) delivers emails; whatever it returns (demo mode only) comes back as devMail.
    const { store, hasher, sessions, random, mailer, now = () => Date.now() } = opts;
    const attempts = new Map();
    function throttle(username, failed, reset) {
      const a = attempts.get(username) || { n: 0, until: 0, first: 0 }, t = now();
      if (reset) { attempts.delete(username); return ''; }
      if (failed) {
        if (t - a.first > 10 * 60000) { a.n = 0; a.first = t; }
        a.n++;
        if (a.n >= 5) a.until = t + 60000;
        attempts.set(username, a);
        return '';
      }
      return a.until > t ? 'Too many sign-in attempts. Wait a minute and try again.' : '';
    }
    async function handle(action, payload, token) {
      const db = store.load(), t = now();
      const uid = token ? sessions.get(token) : null;
      const found = uid ? db.users.find(u => u.id === uid && u.status === 'ACTIVE') : null;
      if (!Array.isArray(db.passwordResets)) db.passwordResets = [];
      db.products.forEach(p => { if (p.image === undefined) p.image = productImage(p.art); });
      const ctx = {
        db, t, actor: found || null, changed: false, hasher, throttle, random, newToken: undefined, devMail: undefined,
        signIn(u) { const tk = random(); sessions.set(tk, u.id); ctx.newToken = tk; },
        signOut() { if (token) sessions.del(token); ctx.newToken = null; },
        dropSessions(userId) { if (sessions.dropUser) sessions.dropUser(userId); },
        mail(msg) { const out = mailer ? mailer(msg) : null; if (out) ctx.devMail = out; }
      };
      if (uid && !found) { sessions.del(token); ctx.newToken = null; }
      const house = housekeeping(db, t);
      const fn = ACTIONS[action];
      try {
        if (!fn) fail(404, 'unknown_action', 'That action isn’t available.');
        const data = await fn(ctx, payload && typeof payload === 'object' ? payload : {});
        if (house || ctx.changed) { db.meta.rev++; store.save(db); }
        if (action === 'ping') return { ok: true, rev: db.meta.rev, token: ctx.newToken };
        return { ok: true, data: data == null ? null : data, view: buildView(db, ctx.actor, t), token: ctx.newToken, devMail: ctx.devMail };
      } catch (e) {
        if (house || ctx.changed) { db.meta.rev++; store.save(db); }
        if (e instanceof ApiError) return { ok: false, status: e.status, error: { code: e.code, message: e.message, fields: e.fields || null }, view: buildView(db, ctx.actor, t), token: ctx.newToken };
        throw e;
      }
    }
    return { handle };
  }

  return { createService, buildSeed, ApiError, PLAYER_TYPES, METHODS, OTHER_REASON, util: { local, iso, addDays, slotMs, hash, rng } };
});

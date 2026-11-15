-- Delivery windows and the 2026-2027 calendar, decided by the founder on 14 November 2026 (session A6).
-- Loaded ONCE per database by scripts/ci/load-seeds.sh, in one transaction with a marker row (settings key
-- `seed_applied:delivery_windows`), the way proposed_pilot_settings.sql is. After that the /windows page owns these rows:
-- a deploy never puts them back. To load again on purpose, delete the marker row (the rows below are added only if a
-- plan, or a calendar entry of the same kind, name and first day, is not already there, so nothing is duplicated).
--
-- Plans (delivery_window_plans, 0040): every weekday (ISO 1 to 7), every zone (zone_id null), four windows a day, 4 orders each.
-- calendar_kind is NULL on purpose: 0040's window_plans_for() makes a plan with a calendar_kind REPLACE the ordinary plans on
-- every day of that kind, so a Ramadan, Lent or holiday plan is a later decision on /windows. Until one exists the calendar rows
-- below of kind ramadan, lent and holiday are labels only (closed = false) and the four windows run on those days as usual.
-- order_by_min 60: the window closes to new orders an hour before it starts. fresh_order_by_min: goods bought for the order
-- close 720 min (12 h) before the 09:00 window, i.e. at 21:00 the evening before, and 240 min (4 h) before the others.
--
-- Calendar (delivery_calendar, 0040): closed = true means no deliveries at all that day. Dates were checked on 14 Nov 2026
-- against church calendars (the Easters, Ash Wednesday, Clean Monday), Umm al-Qura and UAE astronomical tables for the
-- Islamic dates, and the Lebanese government's memoranda and published holiday lists. Lebanon's 2027 holiday decree is not
-- published yet: every date marked "expected" follows an astronomical table or the usual rule, and must be confirmed against
-- Dar al-Fatwa's announcement (moon sighting may shift an Islamic date by a day) or the Prime Minister's memorandum on /windows.

insert into delivery_window_plans(name, weekdays, starts, ends, capacity, order_by_min, fresh_order_by_min, calendar_kind, zone_id, active)
select v.name, '{1,2,3,4,5,6,7}'::smallint[], v.starts::time, v.ends::time, 4, 60, v.fresh, null, null, true
  from (values ('Morning 09:00-11:00', '09:00', '11:00', 720),
               ('Midday 12:00-14:00',  '12:00', '14:00', 240),
               ('Afternoon 16:00-18:00', '16:00', '18:00', 240),
               ('Evening 19:00-21:00', '19:00', '21:00', 240)) as v(name, starts, ends, fresh)
 where not exists (select 1 from delivery_window_plans);

-- One statement, so the calendar trigger regenerates the slots once.
insert into delivery_calendar(kind, name, starts_on, ends_on, closed, note)
select v.kind, v.name, v.starts_on::date, v.ends_on::date, v.closed, v.note
  from (values
    -- ---- closed: no deliveries ----
    ('holiday', 'Christmas Day 2026', '2026-12-25', '2026-12-25', true, 'Founder decision 14 Nov 2026. Fixed date (25 December). Lebanese official holiday.'),
    ('holiday', 'Christmas Day 2027', '2027-12-25', '2027-12-25', true, 'Founder decision 14 Nov 2026. Fixed date (25 December; a Saturday in 2027). Lebanese official holiday.'),
    ('holiday', 'New Year''s Day 2027','2027-01-01', '2027-01-01', true, 'Founder decision 14 Nov 2026. Fixed date. Lebanese official holiday.'),
    ('holiday', 'Western Easter Sunday 2027', '2027-03-28', '2027-03-28', true, 'Founder decision 14 Nov 2026. Western (Gregorian) Easter, 28 March 2027: Catholic and USCCB liturgical calendars, and every church calendar searched.'),
    ('holiday', 'Orthodox Easter Sunday 2027', '2027-05-02', '2027-05-02', true, 'Founder decision 14 Nov 2026. Orthodox (Julian-computus) Easter, 2 May 2027: Orthodox church calendars and holiday listings agree.'),
    ('holiday', 'Eid al-Adha 2027, first day', '2027-05-16', '2027-05-16', true, 'Founder decision 14 Nov 2026. Expected; confirm when the decree is published. 10 Dhu al-Hijjah 1448: Umm al-Qura and UAE astronomical tables give Sunday 16 May 2027, Dar al-Fatwa announces it after the moon sighting (it may be Monday 17 May).'),
    -- ---- seasons: labels only (no plan has these kinds yet) ----
    ('lent', 'Western Lent 2027', '2027-02-10', '2027-03-27', false, 'Ash Wednesday 10 February to Holy Saturday 27 March 2027 (Easter 28 March): Catholic liturgical calendars. Label only: no plan has this kind.'),
    ('lent', 'Orthodox Great Lent 2027', '2027-03-15', '2027-05-01', false, 'Clean Monday 15 March to Holy Saturday 1 May 2027 (Orthodox Easter 2 May): Orthodox church calendars. Label only: no plan has this kind.'),
    ('ramadan', 'Ramadan 2027', '2027-02-08', '2027-03-08', false, 'Expected; confirm when the decree is published. Umm al-Qura and UAE astronomical tables: 1 Ramadan 1448 = Monday 8 February 2027, 29 days. Dar al-Fatwa and the Higher Islamic Shiite Council announce it after the moon sighting and may differ by a day. Label only: no plan has this kind.'),
    -- ---- other official public holidays ----
    ('holiday', 'Independence Day (observed)', '2026-11-23', '2026-11-23', false, 'Reported Prime Minister''s memorandum (25/2026): 22 November falls on a Sunday, so the official closure is Monday 23 November 2026.'),
    ('holiday', 'Armenian Orthodox Christmas', '2027-01-06', '2027-01-06', false, 'Fixed date (6 January). Lebanese official holiday.'),
    ('holiday', 'Feast of St Maroun', '2027-02-09', '2027-02-09', false, 'Fixed date (9 February). Lebanese official holiday; the Prime Minister issues a memorandum each year.'),
    ('holiday', 'Rafik Hariri Memorial Day', '2027-02-14', '2027-02-14', false, 'Fixed date (14 February; a Sunday in 2027). Public and private institutions are closed by memorandum each year (3/2026 for 2026).'),
    ('holiday', 'Eid al-Fitr 2027', '2027-03-09', '2027-03-11', false, 'Expected; confirm when the decree is published. 1 Shawwal 1448: Umm al-Qura gives Tuesday 9 March 2027, UAE tables Tuesday 9 or Wednesday 10 March. The Prime Minister''s memorandum sets how many days public offices close (varies by year); three days are marked here.'),
    ('holiday', 'Feast of the Annunciation', '2027-03-25', '2027-03-25', false, 'Fixed date (25 March). Lebanese official holiday, Christian and Muslim.'),
    ('holiday', 'Good Friday (Western)', '2027-03-26', '2027-03-26', false, 'Two days before Western Easter (28 March 2027). Lebanese official holiday.'),
    ('holiday', 'Good Friday (Orthodox)', '2027-04-30', '2027-04-30', false, 'Two days before Orthodox Easter (2 May 2027). Lebanese official holiday.'),
    ('holiday', 'Labour Day', '2027-05-01', '2027-05-01', false, 'Fixed date (1 May). Lebanese official holiday.'),
    ('holiday', 'Eid al-Adha 2027, second day', '2027-05-17', '2027-05-17', false, 'Expected; confirm when the decree is published. The day after 10 Dhu al-Hijjah 1448 (see the first day). The Prime Minister''s memorandum sets how many days public offices close (2025: two, 2026: by memorandum 12/2026).'),
    ('holiday', 'Resistance and Liberation Day', '2027-05-25', '2027-05-25', false, 'Fixed date (25 May). Lebanese official holiday.'),
    ('holiday', 'Hijri New Year 1449', '2027-06-06', '2027-06-06', false, 'Expected; confirm when the decree is published. 1 Muharram 1449: Umm al-Qura gives Sunday 6 June 2027; moon sighting may shift it a day.'),
    ('holiday', 'Ashoura 1449', '2027-06-15', '2027-06-15', false, 'Expected; confirm when the decree is published. 10 Muharram 1449: Tuesday 15 June 2027 by Umm al-Qura; moon sighting may shift it a day.'),
    ('holiday', 'Birthday of the Prophet (Mawlid)', '2027-08-14', '2027-08-14', false, 'Expected; confirm when the decree is published. 12 Rabi al-Awwal 1449: Saturday 14 August 2027 by Umm al-Qura; some tables give 15 August. Moon sighting may shift it a day.'),
    ('holiday', 'Assumption of Mary', '2027-08-15', '2027-08-15', false, 'Fixed date (15 August; a Sunday in 2027). Lebanese official holiday.'),
    ('holiday', 'Independence Day 2027', '2027-11-22', '2027-11-22', false, 'Fixed date (22 November; a Monday in 2027). Lebanese official holiday.')
  ) as v(kind, name, starts_on, ends_on, closed, note)
 where not exists (select 1 from delivery_calendar c where c.kind = v.kind and c.name = v.name and c.starts_on = v.starts_on::date);

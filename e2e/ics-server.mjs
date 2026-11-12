// Tiny ICS feed for e2e: events are generated relative to "now" so the specs work on any date.
import { createServer } from 'node:http';

const utc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const at = (days, h, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(h, m, 0, 0);
  return d;
};

function feed() {
  const standupStart = at(0, 10);
  const standupEnd = at(0, 11);
  const offsite = at(2, 0);
  const offsiteEnd = at(3, 0);
  const daily = at(0, 16);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//e2e//EN',
    'BEGIN:VEVENT', 'UID:standup@e2e', `DTSTART:${utc(standupStart)}`, `DTEND:${utc(standupEnd)}`, 'SUMMARY:Cal standup', 'LOCATION:Room 4', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:offsite@e2e', `DTSTART;VALUE=DATE:${ymd(offsite)}`, `DTEND;VALUE=DATE:${ymd(offsiteEnd)}`, 'SUMMARY:Cal offsite', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:daily@e2e', `DTSTART:${utc(daily)}`, `DTEND:${utc(new Date(daily.getTime() + 1800000))}`, 'RRULE:FREQ=DAILY;COUNT=40', 'SUMMARY:Cal daily', 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n');
}

createServer((req, res) => {
  if (req.url === '/cal.ics') {
    res.writeHead(200, { 'content-type': 'text/calendar' });
    res.end(feed());
  } else if (req.url === '/current.ics') {
    const now = Date.now();
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//e2e//EN',
      'BEGIN:VEVENT', 'UID:now@e2e', `DTSTART:${utc(new Date(now - 10 * 60_000))}`, `DTEND:${utc(new Date(now + 50 * 60_000))}`, 'SUMMARY:Cal now', 'END:VEVENT',
      'END:VCALENDAR', '',
    ];
    res.writeHead(200, { 'content-type': 'text/calendar' });
    res.end(lines.join('\r\n'));
  } else if (req.url === '/notcal') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html>hello</html>');
  } else {
    res.writeHead(404).end();
  }
}).listen(3102, () => console.log('ICS test server on :3102'));

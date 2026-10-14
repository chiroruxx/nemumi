export function getSiteTimeZone(): string {
  return process.env.TZ || import.meta.env?.TZ || 'Asia/Tokyo';
}

export function formatDateInSiteTimeZone(date: Date): string {
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: getSiteTimeZone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    dateFormatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

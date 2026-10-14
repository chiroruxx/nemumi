export const siteTimeZone = 'Asia/Tokyo';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: siteTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function formatDateInSiteTimeZone(date: Date): string {
  const parts = Object.fromEntries(
    dateFormatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

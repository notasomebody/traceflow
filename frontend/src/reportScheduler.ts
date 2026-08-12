export const localDateKey = (now = new Date()) => {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export function shouldGenerateDaily(now: Date, generateAt: string, alreadyGenerated: boolean, excludedDates: string[] = [], additionalWorkDates: string[] = []) {
  const date = localDateKey(now);
  if (alreadyGenerated || excludedDates.includes(date)) return false;
  if ((now.getDay() === 0 || now.getDay() === 6) && !additionalWorkDates.includes(date)) return false;
  const [hour, minute] = generateAt.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false;
  return now.getHours() * 60 + now.getMinutes() >= hour * 60 + minute;
}

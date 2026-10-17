/** Convert business-day boundaries to UTC before SQL Server compares timestamps. */
function reportDays(from, to, timeZone = "UTC") {
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  if (!valid(from) || !valid(to) || from > to) throw new Error("Choose a valid report date range.");
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23" });
  const midnight = day => {
    const target = Date.parse(`${day}T00:00:00Z`);
    let instant = target;
    for (let i=0; i<6; i++) {
      const p = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type,part.value]));
      const local = Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
      if (local === target) return new Date(instant).toISOString();
      instant += target-local;
    }
    throw new Error("Could not resolve the business-day boundary. Check the timezone setting.");
  };
  const result=[];
  for (let date=Date.parse(from); date<=Date.parse(to); date+=86400000) {
    if (result.length>=3660) throw new Error("Choose a report range shorter than ten years.");
    const day=new Date(date).toISOString().slice(0,10);
    const next=new Date(date+86400000).toISOString().slice(0,10);
    result.push({day, start:midnight(day), end:midnight(next)});
  }
  return result;
}
module.exports={reportDays};

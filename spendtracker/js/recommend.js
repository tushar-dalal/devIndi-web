// Rule-based renew-or-cut verdict (PRD P0 #5, v1). No scoring model: rules are
// checked in order, the first one that fires decides, and every rule — fired
// or not — is returned so the UI can show exactly why on click.

const VERDICT_WINDOW_DAYS = 30;
const MIN_ACTIVE_DAYS = 8;        // fewer active days than this in 30 → Downgrade
const STALE_MANUAL_DAYS = 30;     // "last used" older than this → Cancel

function monthlyPrice(sub) {
  return sub.cycle === "yearly" ? sub.price / 12 : sub.price;
}

function toUsd(amount, currency, fxRate) {
  return currency === "USD" ? amount : amount / fxRate;
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / (24 * 60 * 60 * 1000));
}

// usageRows: every stored usage row. today: "YYYY-MM-DD".
function evaluateSubscription(sub, usageRows, today, settings) {
  const priceUsd = toUsd(monthlyPrice(sub), sub.currency, settings.fxRate);
  const rules = [];
  const decide = (verdict, summary) => ({ verdict, summary, rules });

  if (sub.linkedProvider) {
    const providerName = PROVIDERS[sub.linkedProvider] ? PROVIDERS[sub.linkedProvider].name : sub.linkedProvider;
    const member = sub.member || settings.memberName;
    const mine = usageRows.filter((r) => r.provider === sub.linkedProvider && r.member === member);
    if (mine.length === 0) {
      rules.push({ rule: `Linked to ${providerName} usage for ${member}`, detail: "No data synced yet", fired: true });
      return decide("unknown", `No ${providerName} data yet — connect or sync it first.`);
    }
    const since = new Date(new Date(today) - (VERDICT_WINDOW_DAYS - 1) * 864e5).toISOString().slice(0, 10);
    const recent = mine.filter((r) => r.date >= since && r.date <= today);
    const activeDays = new Set(recent.filter((r) => r.costUsd > 0 || r.requests > 0 || r.outputTokens > 0).map((r) => r.date)).size;
    const valueUsd = recent.reduce((s, r) => s + r.costUsd, 0);

    const r1 = activeDays === 0;
    rules.push({ rule: `Zero usage in the last ${VERDICT_WINDOW_DAYS} days → Cancel`, detail: `${activeDays} active day${activeDays === 1 ? "" : "s"}`, fired: r1 });
    if (r1) return decide("cancel", `Not used at all in ${VERDICT_WINDOW_DAYS} days.`);

    const r2 = valueUsd < priceUsd;
    rules.push({
      rule: `Usage worth less than the monthly price → Downgrade`,
      detail: `${fmtUsdPlain(valueUsd)} of API-equivalent usage vs ${fmtUsdPlain(priceUsd)}/month`,
      fired: r2
    });
    if (r2) return decide("downgrade", `Pay-as-you-go or a lower tier would have cost less this month.`);

    const r3 = activeDays < MIN_ACTIVE_DAYS;
    rules.push({ rule: `Used on fewer than ${MIN_ACTIVE_DAYS} of the last ${VERDICT_WINDOW_DAYS} days → Downgrade`, detail: `${activeDays} active days`, fired: r3 });
    if (r3) return decide("downgrade", `Heavy on a few days, idle on most — a lower tier likely covers it.`);

    rules.push({ rule: "Otherwise → Keep", detail: `${(valueUsd / priceUsd).toFixed(1)}× the price in usage, ${activeDays} active days`, fired: true });
    return decide("keep", `Earning its keep: ${(valueUsd / priceUsd).toFixed(1)}× its price in usage.`);
  }

  // No data source (ChatGPT Plus, Cursor Individual, …): fall back to what the user tells us.
  const age = sub.lastUsed ? daysBetween(sub.lastUsed, today) : null;
  const m1 = age != null && age > STALE_MANUAL_DAYS;
  rules.push({ rule: `Last used more than ${STALE_MANUAL_DAYS} days ago → Cancel`, detail: sub.lastUsed ? `Last used ${age} days ago (${sub.lastUsed})` : "No last-used date", fired: m1 });
  if (m1) return decide("cancel", `Last used ${age} days ago.`);

  const m2 = sub.frequency === "rarely";
  rules.push({ rule: `You use it rarely → Downgrade`, detail: sub.frequency ? `Marked “${sub.frequency}”` : "No frequency set", fired: m2 });
  if (m2) return decide("downgrade", "You marked it as rarely used.");

  if (age == null && !sub.frequency) {
    rules.push({ rule: "Not enough information", detail: "Add a last-used date or a usage frequency", fired: true });
    return decide("unknown", "Add a last-used date or usage frequency to get a verdict.");
  }
  rules.push({ rule: "Otherwise → Keep", detail: "Used recently and regularly", fired: true });
  return decide("keep", "Used recently and regularly.");
}

function fmtUsdPlain(v) {
  return "$" + v.toFixed(v >= 100 ? 0 : 2);
}

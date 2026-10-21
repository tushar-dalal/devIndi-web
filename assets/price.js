/* Shows an INR price in the visitor's own currency as well, e.g. "≈ US$15.78".
 *
 * Mark up:  <span data-inr="1499"></span>   → filled with "≈ US$15.78 in your currency"
 * Visitors in India (or whose currency can't be worked out) see nothing extra.
 * Rates come from open.er-api.com (free, no key) and are cached for 12 hours in this browser.
 * The amount is an estimate: the buyer's bank does the final conversion.
 */
(function () {
  var targets = document.querySelectorAll('[data-inr]');
  if (!targets.length) return;

  // Country -> currency for the places most visitors come from.
  var CURRENCY = {
    US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', SG: 'SGD', AE: 'AED', SA: 'SAR', QA: 'QAR',
    KW: 'KWD', OM: 'OMR', BH: 'BHD', JP: 'JPY', CN: 'CNY', HK: 'HKD', TW: 'TWD', KR: 'KRW', CH: 'CHF',
    SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', TR: 'TRY', IL: 'ILS',
    BR: 'BRL', MX: 'MXN', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN', ZA: 'ZAR', NG: 'NGN', KE: 'KES',
    EG: 'EGP', MY: 'MYR', ID: 'IDR', PH: 'PHP', TH: 'THB', VN: 'VND', PK: 'PKR', BD: 'BDT', LK: 'LKR',
    NP: 'NPR', IN: 'INR', RU: 'RUB', UA: 'UAH'
  };
  ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL',
   'PT', 'SI', 'SK'].forEach(function (c) { CURRENCY[c] = 'EUR'; });

  // Time zone is the best hint of where someone is; the browser language region is the fallback.
  var ZONE = {
    'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Europe/London': 'GB', 'Europe/Dublin': 'IE',
    'Asia/Dubai': 'AE', 'Asia/Singapore': 'SG', 'Asia/Tokyo': 'JP', 'Asia/Hong_Kong': 'HK',
    'Asia/Shanghai': 'CN', 'Asia/Seoul': 'KR', 'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD',
    'Asia/Colombo': 'LK', 'Asia/Kathmandu': 'NP', 'Asia/Riyadh': 'SA', 'Asia/Qatar': 'QA',
    'Asia/Kuala_Lumpur': 'MY', 'Asia/Jakarta': 'ID', 'Asia/Manila': 'PH', 'Asia/Bangkok': 'TH',
    'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Perth': 'AU', 'Australia/Brisbane': 'AU',
    'Pacific/Auckland': 'NZ', 'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Mexico_City': 'MX',
    'America/Sao_Paulo': 'BR', 'Africa/Johannesburg': 'ZA', 'Africa/Lagos': 'NG', 'Africa/Nairobi': 'KE',
    'Africa/Cairo': 'EG', 'Europe/Zurich': 'CH', 'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO',
    'Europe/Copenhagen': 'DK', 'Europe/Warsaw': 'PL', 'Europe/Istanbul': 'TR'
  };

  function country() {
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    if (ZONE[tz]) return ZONE[tz];
    if (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit)/.test(tz)) return 'US';
    if (/^Europe\/(Berlin|Paris|Madrid|Rome|Amsterdam|Brussels|Vienna|Lisbon|Helsinki|Athens)/.test(tz)) return 'DE';
    var langs = navigator.languages || [navigator.language || ''];
    for (var i = 0; i < langs.length; i++) {
      var m = /-([A-Z]{2})$/i.exec(langs[i] || '');
      if (m) return m[1].toUpperCase();
    }
    return '';
  }

  var cur = CURRENCY[country()];
  if (!cur || cur === 'INR') return;

  function show(rate) {
    if (!rate) return;
    targets.forEach(function (el) {
      var inr = parseFloat(el.getAttribute('data-inr'));
      var amount = inr * rate;
      var fmt;
      try {
        fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: cur,
          maximumFractionDigits: amount >= 1000 ? 0 : 2 }).format(amount);
      } catch (e) { return; }
      // A bare "$" is ambiguous next to a rupee price: say which dollar it is.
      var DOLLAR = { USD: 'US$', CAD: 'CA$', AUD: 'A$', NZD: 'NZ$', SGD: 'S$', HKD: 'HK$', MXN: 'MX$', TWD: 'NT$' };
      if (DOLLAR[cur]) fmt = fmt.replace(/(US|CA|A|NZ|S|HK|MX|NT)?\$/, DOLLAR[cur]);
      el.textContent = (el.getAttribute('data-inr-prefix') || '≈ ') + fmt +
        (el.getAttribute('data-inr-suffix') || '');
      el.hidden = false;
    });
  }

  var KEY = 'devindi_fx_inr';
  try {
    var cached = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (cached && Date.now() - cached.t < 12 * 3600 * 1000 && cached.rates[cur]) return show(cached.rates[cur]);
  } catch (e) {}
  fetch('https://open.er-api.com/v6/latest/INR')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || !d.rates) return;
      try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), rates: d.rates })); } catch (e) {}
      show(d.rates[cur]);
    })
    .catch(function () { /* no estimate; the INR price still shows */ });
})();

/* Shared plan metrics for admin stats (mirrors index.html packing/outfit/deadline logic). */

const DEFAULT_DEADLINE_COUNT = 8;
const DAY_COUNT = 10;
const SLOT_KEYS = ['gym', 'day', 'eve'];

const CHECKLISTS = {
  'Important Items': ['Valid U.S. Passport (everyone!)', 'Cruise electronic documents & luggage tags', 'Credit cards & cash', 'Prescription medication & general medicine', 'Phone chargers', 'USB expander plug', 'Cameras & memory card', 'Flight confirmations / boarding passes', 'Hotel confirmation (Miami 7/16–7/18)'],
  'Quinceañera Must-Haves': ['Quinceañera dress (CARRY-ON garment bag)', 'Tiara / hair accessories', 'Jewelry for the celebration', 'Shoes for the ceremony', ['Comfy backup shoes', 2], 'Steamer or wrinkle-release spray'],
  'Theme Nights': ['Tropical/Caribbean-color outfit (Sat — Welcome Party)', 'Ball attire: gown/cocktail dress or tux/dark suit (Sun — Quinceañeras Ball)', 'Caribbean Night outfit (Tue)', 'WHITE outfit for Latin Night (Wed)', 'Dress-your-best outfit (Thu)', 'Guayabera / Cuban-theme outfit (Fri — Farewell Party)'],
  'General List': ['Sunglasses', 'Cosmetics', 'Perfume/Cologne', 'Comb/Brush', 'Blow dryer', 'Curling/Flat iron', 'Shampoo', 'Conditioner', 'Toothbrush & toothpaste', 'Razors', 'Shaving cream', 'Deodorant', 'Face creams', 'Hair gel/spray', 'Hand lotions', 'Suntan lotion', 'After-tan cream', 'Needles and thread', 'Plastic bags', 'Spot remover', 'Magnetic hooks', 'Small ziplock bags', 'Pop-up hamper'],
  'His Checklist': [['Bathing suit', 2], ['Shorts', 5], ['Casual shirts', 7], ['Underwear', 10], ['Socks', 8], ['Pajamas', 2], ['Slacks', 3], ['Dress shirts', 3], 'Suit', 'Sweater', 'Handkerchiefs', 'Ties, tie clasp, belts', 'Shoes', 'Hat/Cap', 'Tuxedo & accessories'],
  'Her Checklist': [['Swimsuit/Cover-up', 3], ['Shorts/Bermudas', 5], ['Casual shirts', 7], ['Lingerie', 10], ['Hosiery', 4], 'Robe', ['Dresses — casual/formal', 5], ['Pant suits', 2], 'Sweater', 'Belts', 'Purses', 'Hats', 'Shoes', 'Jewelry']
};

function itemQty(it) { return Array.isArray(it) ? it[1] : 1; }

function needOf(data, person, sec, i, item) {
  const k = person + '|' + sec + '|' + i;
  return data.need && data.need[k] !== undefined ? data.need[k] : itemQty(item);
}

function packedOf(data, person, sec, i) {
  const k = person + '|' + sec + '|' + i;
  const v = data.packed && data.packed[k];
  return v === undefined ? 0 : v;
}

function computePlanMetrics(data) {
  const plan = data && typeof data === 'object' ? data : {};
  const people = Array.isArray(plan.people) && plan.people.length ? plan.people : ['Me'];
  const deadlines = Array.isArray(plan.deadlines) ? plan.deadlines : [];

  let packTotal = 0;
  let packDone = 0;
  let customPackingItems = 0;

  people.forEach(person => {
    Object.entries(CHECKLISTS).forEach(([sec, items]) => {
      const custom = (plan.custom && plan.custom[person + '|' + sec]) || [];
      customPackingItems += custom.length;
      const all = items.concat(custom);
      all.forEach((it, i) => {
        packTotal++;
        const need = needOf(plan, person, sec, i, it);
        if (need > 0 && packedOf(plan, person, sec, i) >= need) packDone++;
      });
    });
  });

  let outfitTotal = 0;
  let outfitFilled = 0;
  people.forEach(person => {
    for (let di = 0; di < DAY_COUNT; di++) {
      SLOT_KEYS.forEach(sk => {
        outfitTotal++;
        const v = plan.outfits && plan.outfits[person + '|' + di + '|' + sk];
        if (v && v.t) outfitFilled++;
      });
    }
  });

  const deadlinesTotal = deadlines.length;
  const deadlinesDone = deadlines.filter(d => d && d.done).length;
  const customDeadlines = Math.max(0, deadlinesTotal - DEFAULT_DEADLINE_COUNT);

  return {
    peopleCount: people.length,
    packingPct: packTotal ? Math.round((100 * packDone) / packTotal) : 0,
    packDone,
    packTotal,
    outfitsPct: outfitTotal ? Math.round((100 * outfitFilled) / outfitTotal) : 0,
    outfitFilled,
    outfitTotal,
    deadlinesDone,
    deadlinesTotal,
    customDeadlines,
    customPackingItems
  };
}

function productHints(row) {
  const hints = [];
  if (row.memberCount === 1) hints.push('Invite not used');
  if (row.packingPct < 20 && row.activeRecent) hints.push('Active but not packing');
  if (row.outfitsPct === 0 && row.peopleCount > 0) hints.push('Outfits unused');
  if (row.customDeadlines > 0) hints.push('Customized checklist');
  if (row.customPackingItems > 0) hints.push('Custom packing items');
  return hints;
}

module.exports = { computePlanMetrics, productHints };

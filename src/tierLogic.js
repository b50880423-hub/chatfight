const TIERS = [
  { min: 0, title: 'Unranked', icon: '', medal: '▫️' },
  { min: 10000, title: 'Bronze League', icon: 'I', medal: '🥉' },
  { min: 20000, title: 'Bronze League', icon: 'II', medal: '🥉' },
  { min: 30000, title: 'Bronze League', icon: 'III', medal: '🥉' },
  { min: 45000, title: 'Silver League', icon: 'I', medal: '🥈' },
  { min: 60000, title: 'Silver League', icon: 'II', medal: '🥈' },
  { min: 75000, title: 'Silver League', icon: 'III', medal: '🥈' },
  { min: 100000, title: 'Gold League', icon: 'I', medal: '🥇' },
  { min: 125000, title: 'Gold League', icon: 'II', medal: '🥇' },
  { min: 150000, title: 'Gold League', icon: 'III', medal: '🥇' },
  { min: 200000, title: 'Platinum League', icon: '', medal: '🏆' },
  { min: 350000, title: 'Diamond League', icon: '', medal: '💎' },
  { min: 500000, title: 'Crown League', icon: '', medal: '👑' },
  { min: 800000, title: 'Titanium League', icon: '', medal: '⚙️' },
];

function displayTitle(tier) {
  return tier.icon ? `${tier.title} ${tier.icon}` : tier.title;
}

export function getTier(messageCount = 0) {
  const count = Math.max(0, Math.trunc(Number(messageCount) || 0));
  let index = 0;
  for (let i = 0; i < TIERS.length; i += 1) {
    if (count >= TIERS[i].min) index = i;
    else break;
  }
  const current = TIERS[index];
  const next = TIERS[index + 1] || null;
  return {
    level: index + 1,
    title: current.title,
    icon: current.icon,
    medal: current.medal,
    displayTitle: displayTitle(current),
    messages: count,
    nextTitle: next ? displayTitle(next) : null,
    nextMessages: next?.min ?? null,
    progress: next ? count - current.min : 0,
    requiredForNext: next ? next.min - current.min : 0,
    messagesRemaining: next ? Math.max(0, next.min - count) : 0,
    maxLevel: !next,
  };
}

export function getRankedUserStats(user, rank = null) {
  const tier = getTier(user?.messageCount || 0);
  return {
    rank,
    level: tier.level,
    title: tier.title,
    icon: tier.icon,
    displayTitle: tier.displayTitle,
    messages: tier.messages,
    nextTitle: tier.nextTitle,
    nextMessages: tier.nextMessages,
  };
}

export { TIERS };

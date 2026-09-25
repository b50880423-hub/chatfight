const TIERS = [
  { min: 0, title: 'Rookie', icon: 'I' },
  { min: 25, title: 'Scout', icon: 'II' },
  { min: 75, title: 'Striker', icon: 'III' },
  { min: 150, title: 'Fighter', icon: 'IV' },
  { min: 300, title: 'Veteran', icon: 'V' },
  { min: 600, title: 'Elite', icon: 'VI' },
  { min: 1000, title: 'Master', icon: 'VII' },
  { min: 2000, title: 'Grandmaster', icon: 'VIII' },
  { min: 4000, title: 'Champion', icon: 'IX' },
  { min: 7500, title: 'Legend', icon: 'X' },
  { min: 10000, title: 'Mythic', icon: 'XI' },
  { min: 30000, title: 'Immortal', icon: 'XII' },
  { min: 70000, title: 'Titan', icon: 'XIII' },
  { min: 120000, title: 'Supreme', icon: 'XIV' },
  { min: 200000, title: 'Apex', icon: 'XV' },
  { min: 300000, title: 'Conqueror', icon: 'XVI' },
  { min: 450000, title: 'Dominator', icon: 'XVII' },
  { min: 650000, title: 'Overlord', icon: 'XVIII' },
  { min: 1000000, title: 'The Unstoppable', icon: 'XIX' },
];

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
    messages: count,
    nextTitle: next?.title || null,
    nextMessages: next?.min ?? null,
    progress: next ? count - current.min : 0,
    requiredForNext: next ? next.min - current.min : 0,
  };
}

export function getRankedUserStats(user, rank = null) {
  const tier = getTier(user?.messageCount || 0);
  return {
    rank,
    level: tier.level,
    title: tier.title,
    icon: tier.icon,
    messages: tier.messages,
    nextTitle: tier.nextTitle,
    nextMessages: tier.nextMessages,
  };
}

export { TIERS };

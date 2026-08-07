export function formatProfileText(user, rank, totalUsers) {
  const name = user.userName || `User ${user.userId}`;
  return [
    `👤 ${name}`,
    '',
    `Total messages: ${user.messageCount || 0}`,
    `Today messages: ${user.dailyMessageCount || 0}`,
    `This week: ${user.weeklyMessageCount || 0}`,
    `Overall rank: #${rank} of ${totalUsers}`,
    `Joined: ${new Date(user.createdAt).toLocaleDateString()}`,
  ].join('\n');
}

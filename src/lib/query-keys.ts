export const queryKeys = {
  session: (userId: string) => ["session", userId] as const,
  dashboard: {
    root: (userId: string) => [...queryKeys.session(userId), "dashboard"] as const,
    youtube: (userId: string, channelId: string | null) =>
      [...queryKeys.dashboard.root(userId), "youtube", channelId] as const,
    revenue: (userId: string, channelId: string | null) =>
      [...queryKeys.dashboard.root(userId), "revenue", channelId] as const,
  },
};

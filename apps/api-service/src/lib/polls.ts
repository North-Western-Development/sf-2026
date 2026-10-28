import { and, eq, sql, pollVotes, type TransmissionPoll } from '@subspace/database';

/** Polls: whether one is over, its counts, and how the client sees it. */
export const pollEnded = (p: TransmissionPoll) => !!p.endedAt || new Date(p.expiresAt).getTime() <= Date.now();

/** Vote counts for a poll, and the caller's own votes. */
export async function pollResults(db: any, transmissionId: string, callerId?: string) {
  const rows = await db
    .select({ answerId: pollVotes.answerId, n: sql<number>`count(*)::int` })
    .from(pollVotes)
    .where(eq(pollVotes.transmissionId, transmissionId))
    .groupBy(pollVotes.answerId);
  const counts: Record<number, number> = Object.fromEntries(rows.map((r: any) => [r.answerId, r.n]));
  const voters = await db.select({ id: pollVotes.transmitterId }).from(pollVotes).where(eq(pollVotes.transmissionId, transmissionId));
  const mine = callerId ? (await db.select({ answerId: pollVotes.answerId }).from(pollVotes).where(and(eq(pollVotes.transmissionId, transmissionId), eq(pollVotes.transmitterId, callerId)))).map((r: any) => r.answerId) : [];
  return { counts, totalVoters: new Set(voters.map((v: any) => v.id)).size, myVotes: mine };
}

/** The poll as the client shows it. */
export async function formatPoll(db: any, row: { id: string; poll: TransmissionPoll | null }, callerId: string) {
  if (!row.poll) return null;
  const r = await pollResults(db, row.id, callerId);
  return {
    question: row.poll.question,
    answers: row.poll.answers.map((a) => ({ ...a, votes: r.counts[a.id] ?? 0 })),
    allowMultiselect: row.poll.allowMultiselect,
    expiresAt: row.poll.expiresAt,
    ended: pollEnded(row.poll),
    totalVoters: r.totalVoters,
    myVotes: r.myVotes,
  };
}

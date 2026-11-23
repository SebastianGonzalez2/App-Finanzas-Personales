import { SessionCheckError } from '../auth/session.js';

export async function getPreferences(client, accessToken, signal) {
  const { data, error, status } = await client.schema('api').rpc('get_preferences')
    .setHeader('Authorization', `Bearer ${accessToken}`)
    .abortSignal(signal);

  if (error) throw new SessionCheckError(status);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data?.today) || !Number.isFinite(Date.parse(data.today))) {
    throw new SessionCheckError(500);
  }
  return data;
}
